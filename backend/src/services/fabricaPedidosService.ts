import { pool } from "../db/pool";
import { dataIso } from "./fabricaData";
import { listarProdutos } from "./fabricaProdutosService";

// Pedido de venda da Fábrica Distribuidora.
//
// A fábrica vende pras 20 lojas do grupo e pra clientes de fora. Isso não tem
// nada a ver com as vendas do Mercado Livre que o Financeiro acompanha — ali é
// a loja vendendo pro consumidor final; aqui é a fábrica vendendo pra loja.
//
// Preço e custo são GRAVADOS no item, não recalculados. É a exceção deliberada
// à regra de "nada derivável é guardado": uma venda que aconteceu é um fato.
// Se a margem de um pedido de março fosse recalculada com o preço da resina de
// hoje, o histórico mudaria sozinho e ninguém conseguiria fechar um mês.

export type StatusPedido = "ABERTO" | "ENTREGUE" | "CANCELADO";

export interface ItemPedido {
  id: number;
  produtoId: number;
  produtoSku: string;
  produtoNome: string;
  quantidade: number;
  precoUnitario: number;
  custoUnitario: number;
  // derivados da linha
  total: number;
  custoTotal: number;
  margemContribuicao: number;
  percentualLucro: number;
}

export interface Pedido {
  id: number;
  clienteId: number;
  clienteNome: string;
  clienteTipo: string;
  data: string;
  status: StatusPedido;
  observacao: string | null;
  itens: ItemPedido[];
  // derivados do pedido
  total: number;
  custoTotal: number;
  margemContribuicao: number;
  percentualLucro: number;
}

export interface ItemEntrada {
  produtoId: number;
  quantidade: number;
  // quando não vem, usa o preço do cadastro do produto
  precoUnitario?: number | null;
}

export interface PedidoEntrada {
  clienteId: number;
  data: string | null;
  status: StatusPedido;
  observacao: string | null;
  itens: ItemEntrada[];
}

const STATUS: StatusPedido[] = ["ABERTO", "ENTREGUE", "CANCELADO"];

export function statusValido(v: unknown): v is StatusPedido {
  return typeof v === "string" && STATUS.includes(v as StatusPedido);
}

function indicadores(total: number, custoTotal: number) {
  const margemContribuicao = total - custoTotal;
  return {
    margemContribuicao,
    percentualLucro: total > 0 ? margemContribuicao / total : 0,
  };
}

// --- leitura -----------------------------------------------------------------

interface LinhaPedido {
  id: number;
  cliente_id: number;
  cliente_nome: string;
  cliente_tipo: string;
  data: string;
  status: string;
  observacao: string | null;
}

interface LinhaItem {
  id: number;
  pedido_id: number;
  produto_id: number;
  sku: string;
  nome: string;
  quantidade: string;
  preco_unitario: string;
  custo_unitario: string;
}

function montarItem(r: LinhaItem): ItemPedido {
  const quantidade = Number(r.quantidade);
  const precoUnitario = Number(r.preco_unitario);
  const custoUnitario = Number(r.custo_unitario);
  const total = quantidade * precoUnitario;
  const custoTotal = quantidade * custoUnitario;
  return {
    id: r.id,
    produtoId: r.produto_id,
    produtoSku: r.sku,
    produtoNome: r.nome,
    quantidade,
    precoUnitario,
    custoUnitario,
    total,
    custoTotal,
    ...indicadores(total, custoTotal),
  };
}

export interface FiltroPedidos {
  clienteId?: number;
  status?: StatusPedido;
  de?: string;
  ate?: string;
  limite?: number;
}

// Quantos pedidos o filtro tem no total, ignorando o teto da listagem.
//
// A tela mostra 200 e nao dizia que mostrava 200. Agosto de 2026 tem 334, e
// contar na tela dava 200 — parecia dado faltando. Quem le so o que aparece
// conclui errado, e o erro e silencioso.
export async function contarPedidos(filtro: FiltroPedidos = {}): Promise<number> {
  const condicoes: string[] = [];
  const params: unknown[] = [];
  if (filtro.clienteId) {
    params.push(filtro.clienteId);
    condicoes.push(`p.cliente_id = $${params.length}`);
  }
  if (filtro.status) {
    params.push(filtro.status);
    condicoes.push(`p.status = $${params.length}`);
  }
  if (filtro.de) {
    params.push(filtro.de);
    condicoes.push(`p.data >= $${params.length}::date`);
  }
  if (filtro.ate) {
    params.push(filtro.ate);
    condicoes.push(`p.data <= $${params.length}::date`);
  }
  const where = condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : "";
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM fabrica_pedidos p ${where}`,
    params
  );
  return Number(rows[0]?.n ?? 0);
}

export async function listarPedidos(filtro: FiltroPedidos = {}): Promise<Pedido[]> {
  const condicoes: string[] = [];
  const params: unknown[] = [];
  if (filtro.clienteId) {
    params.push(filtro.clienteId);
    condicoes.push(`p.cliente_id = $${params.length}`);
  }
  if (filtro.status) {
    params.push(filtro.status);
    condicoes.push(`p.status = $${params.length}`);
  }
  if (filtro.de) {
    params.push(filtro.de);
    condicoes.push(`p.data >= $${params.length}::date`);
  }
  if (filtro.ate) {
    params.push(filtro.ate);
    condicoes.push(`p.data <= $${params.length}::date`);
  }
  // teto de 5.000 mesmo quando pedem tudo: cada pedido carrega os itens junto,
  // e um mes cheio ja passa de treze mil linhas de item
  params.push(Math.min(Math.max(filtro.limite ?? 200, 1), 5000));
  const where = condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : "";

  const { rows } = await pool.query<LinhaPedido>(
    `SELECT p.id, p.cliente_id, c.nome AS cliente_nome, c.tipo AS cliente_tipo,
            p.data, p.status, p.observacao
     FROM fabrica_pedidos p
     JOIN fabrica_clientes c ON c.id = p.cliente_id
     ${where}
     ORDER BY p.data DESC, p.id DESC
     LIMIT $${params.length}`,
    params
  );
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);
  const { rows: itens } = await pool.query<LinhaItem>(
    `SELECT i.id, i.pedido_id, i.produto_id, pr.sku, pr.nome,
            i.quantidade, i.preco_unitario, i.custo_unitario
     FROM fabrica_pedido_itens i
     JOIN fabrica_produtos pr ON pr.id = i.produto_id
     WHERE i.pedido_id = ANY($1)
     ORDER BY i.ordem, i.id`,
    [ids]
  );

  const porPedido = new Map<number, ItemPedido[]>();
  for (const r of itens) {
    const lista = porPedido.get(r.pedido_id) ?? [];
    lista.push(montarItem(r));
    porPedido.set(r.pedido_id, lista);
  }

  return rows.map((r) => {
    const lista = porPedido.get(r.id) ?? [];
    const total = lista.reduce((s, i) => s + i.total, 0);
    const custoTotal = lista.reduce((s, i) => s + i.custoTotal, 0);
    return {
      id: r.id,
      clienteId: r.cliente_id,
      clienteNome: r.cliente_nome,
      clienteTipo: r.cliente_tipo,
      data: dataIso(r.data),
      status: (statusValido(r.status) ? r.status : "ABERTO") as StatusPedido,
      observacao: r.observacao,
      itens: lista,
      total,
      custoTotal,
      ...indicadores(total, custoTotal),
    };
  });
}

export async function obterPedido(id: number): Promise<Pedido | null> {
  const { rows } = await pool.query<{ id: number }>("SELECT id FROM fabrica_pedidos WHERE id = $1", [id]);
  if (!rows.length) return null;
  const lista = await listarPedidos({ limite: 1000 });
  return lista.find((p) => p.id === id) ?? null;
}

// --- escrita -----------------------------------------------------------------

// Grava os itens tirando preço e custo do cadastro no momento do lançamento.
// O preço pode vir digitado (a loja negociou), o custo nunca — é o que a
// fórmula e a embalagem custam hoje, e vira fato histórico ao ser gravado.
async function gravarItens(pedidoId: number, itens: ItemEntrada[]): Promise<void> {
  await pool.query("DELETE FROM fabrica_pedido_itens WHERE pedido_id = $1", [pedidoId]);
  if (!itens.length) return;

  const produtos = await listarProdutos();
  const porId = new Map(produtos.map((p) => [p.id, p]));

  let ordem = 0;
  for (const item of itens) {
    const produto = porId.get(item.produtoId);
    if (!produto) throw new Error(`Produto ${item.produtoId} não encontrado.`);
    const preco =
      item.precoUnitario !== undefined && item.precoUnitario !== null && Number.isFinite(item.precoUnitario)
        ? Number(item.precoUnitario)
        : produto.precoVenda;
    await pool.query(
      `INSERT INTO fabrica_pedido_itens
         (pedido_id, produto_id, quantidade, preco_unitario, custo_unitario, ordem)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [pedidoId, produto.id, item.quantidade, preco, produto.custo, ordem++]
    );
  }
}

function validar(e: PedidoEntrada): void {
  if (!Number.isInteger(e.clienteId) || e.clienteId <= 0) throw new Error("Escolha o cliente.");
  if (!e.itens.length) throw new Error("O pedido precisa de pelo menos um item.");
  for (const i of e.itens) {
    if (!Number.isInteger(i.produtoId) || i.produtoId <= 0) throw new Error("Item sem produto.");
    if (!Number.isFinite(i.quantidade) || i.quantidade <= 0) {
      throw new Error("Quantidade deve ser maior que zero.");
    }
  }
}

export async function criarPedido(e: PedidoEntrada): Promise<{ id: number }> {
  validar(e);
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO fabrica_pedidos (cliente_id, data, status, observacao)
     VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4) RETURNING id`,
    [e.clienteId, e.data, e.status, e.observacao]
  );
  await gravarItens(rows[0].id, e.itens);
  return { id: rows[0].id };
}

export async function atualizarPedido(id: number, e: PedidoEntrada): Promise<void> {
  validar(e);
  await pool.query(
    `UPDATE fabrica_pedidos
     SET cliente_id = $2, data = COALESCE($3::date, data), status = $4, observacao = $5
     WHERE id = $1`,
    [id, e.clienteId, e.data, e.status, e.observacao]
  );
  await gravarItens(id, e.itens);
}

// Trocar só o status não mexe nos itens — não pode reprecificar um pedido
// antigo só porque ele foi marcado como entregue.
export async function definirStatus(id: number, status: StatusPedido): Promise<void> {
  await pool.query("UPDATE fabrica_pedidos SET status = $2 WHERE id = $1", [id, status]);
}

export async function excluirPedido(id: number): Promise<void> {
  await pool.query("DELETE FROM fabrica_pedidos WHERE id = $1", [id]);
}

// ---------------------------------------------------------------------------
// Preenche o custo que nunca foi gravado.
//
// Isto NÃO é recalcular. A regra lá em cima continua de pé: venda que aconteceu
// é um fato, e a margem de um pedido de março não pode mudar porque a resina
// subiu em agosto.
//
// Zero é outra coisa. Agosto de 2026 entrou por importação quando o catálogo
// ainda estava vazio — 3.696 produtos foram cadastrados no ERP depois disso.
// Os 22 pedidos ficaram com custo 0,00 em R$ 2.728.714,65 vendidos, e margem
// 100%. Não é um fato histórico: é um valor que ninguém tinha pra gravar.
//
// Por isso mexe só no item com custo exatamente zero, e nunca no que já tem
// número. Item cujo produto continua sem custo hoje fica como está e sai na
// lista — preencher com zero de novo não seria conserto nenhum.

export interface LinhaCustoFaltante {
  pedidoId: number;
  data: string;
  cliente: string;
  sku: string;
  quantidade: number;
  custoUnitario: number;
  custoTotal: number;
}

export interface ResultadoCustoFaltante {
  simulacao: boolean;
  itensZerados: number;
  itensPreenchidos: number;
  pedidosTocados: number;
  custoTotal: number;
  linhas: LinhaCustoFaltante[];
  semCustoNoCadastro: Array<{ sku: string; itens: number; motivo: string[] }>;
}

export async function preencherCustoFaltante(
  de: string,
  ate: string,
  simulacao: boolean
): Promise<ResultadoCustoFaltante> {
  const { rows } = await pool.query<{
    item_id: string;
    pedido_id: string;
    data: string;
    cliente: string;
    produto_id: string;
    sku: string;
    quantidade: string;
  }>(
    `SELECT i.id AS item_id, p.id AS pedido_id, p.data, c.nome AS cliente,
            i.produto_id, pr.sku, i.quantidade
       FROM fabrica_pedido_itens i
       JOIN fabrica_pedidos p ON p.id = i.pedido_id
       JOIN fabrica_clientes c ON c.id = p.cliente_id
       JOIN fabrica_produtos pr ON pr.id = i.produto_id
      WHERE p.data BETWEEN $1 AND $2
        AND i.custo_unitario = 0
      ORDER BY p.data, p.id, i.ordem`,
    [de, ate]
  );

  const produtos = await listarProdutos();
  const porId = new Map(produtos.map((p) => [p.id, p]));

  const linhas: LinhaCustoFaltante[] = [];
  const pedidos = new Set<number>();
  const semCusto = new Map<string, { sku: string; itens: number; motivo: string[] }>();
  let custoTotal = 0;

  for (const r of rows) {
    const produto = porId.get(Number(r.produto_id));
    const custo = produto ? Number(produto.custo) : 0;
    if (!produto || !custo) {
      const atual = semCusto.get(r.sku) ?? {
        sku: r.sku,
        itens: 0,
        motivo: produto?.semCusto ?? ["produto não encontrado"],
      };
      atual.itens += 1;
      semCusto.set(r.sku, atual);
      continue;
    }
    const quantidade = Number(r.quantidade);
    if (!simulacao) {
      await pool.query("UPDATE fabrica_pedido_itens SET custo_unitario = $2 WHERE id = $1", [
        Number(r.item_id),
        custo,
      ]);
    }
    pedidos.add(Number(r.pedido_id));
    custoTotal += quantidade * custo;
    linhas.push({
      pedidoId: Number(r.pedido_id),
      data: String(r.data).slice(0, 10),
      cliente: r.cliente,
      sku: r.sku,
      quantidade,
      custoUnitario: custo,
      custoTotal: quantidade * custo,
    });
  }

  return {
    simulacao,
    itensZerados: rows.length,
    itensPreenchidos: linhas.length,
    pedidosTocados: pedidos.size,
    custoTotal,
    linhas,
    semCustoNoCadastro: [...semCusto.values()].sort((a, b) => b.itens - a.itens),
  };
}

// ---------------------------------------------------------------------------
// Apaga os pedidos de um período pra ele ser refeito por uma fonte só.
//
// Agosto de 2026 entrou duas vezes. Primeiro por planilha, com o mês inteiro
// empilhado no dia 31; depois pelo Bling, com a data real de cada pedido. A
// importação não percebeu: ela só reconhece linha repetida dentro da MESMA
// origem, e planilha e Bling são origens diferentes. R$ 529.525,65 a mais.
//
// Não dá pra remendar linha a linha: a planilha achatou a data, então nem dá pra
// dizer qual linha da planilha corresponde a qual pedido do Bling. O caminho
// honesto é apagar o período e reimportar de uma fonte só — o Bling, que é de
// onde sai a cobrança das lojas.
//
// O pagamento não é tocado: ele é ligado ao cliente, não ao pedido. Os 100
// pagamentos de agosto continuam onde estão, e a dívida se recalcula sozinha
// contra os pedidos novos.

export interface ResultadoRefazer {
  simulacao: boolean;
  de: string;
  ate: string;
  pedidos: number;
  itens: number;
  valor: number;
  porOrigem: Record<string, { pedidos: number; valor: number }>;
}

export async function refazerPeriodo(
  de: string,
  ate: string,
  simulacao: boolean
): Promise<ResultadoRefazer> {
  const { rows } = await pool.query<{
    id: string;
    observacao: string | null;
    itens: string;
    valor: string;
  }>(
    `SELECT p.id, p.observacao,
            COUNT(i.id) AS itens,
            COALESCE(SUM(i.quantidade * i.preco_unitario), 0) AS valor
       FROM fabrica_pedidos p
       LEFT JOIN fabrica_pedido_itens i ON i.pedido_id = p.id
      WHERE p.data BETWEEN $1 AND $2
      GROUP BY p.id, p.observacao`,
    [de, ate]
  );

  const porOrigem: Record<string, { pedidos: number; valor: number }> = {};
  let itens = 0;
  let valor = 0;
  for (const r of rows) {
    const chave = r.observacao ?? "(lançado à mão)";
    const atual = porOrigem[chave] ?? { pedidos: 0, valor: 0 };
    atual.pedidos += 1;
    atual.valor += Number(r.valor);
    porOrigem[chave] = atual;
    itens += Number(r.itens);
    valor += Number(r.valor);
  }

  if (!simulacao && rows.length) {
    // o item e o registro de importação saem por cascata: fabrica_venda_importada
    // referencia o pedido com ON DELETE CASCADE, então a linha volta a ser
    // importável sem ninguém limpar nada à mão
    await pool.query("DELETE FROM fabrica_pedidos WHERE data BETWEEN $1 AND $2", [de, ate]);
  }

  return { simulacao, de, ate, pedidos: rows.length, itens, valor, porOrigem };
}
