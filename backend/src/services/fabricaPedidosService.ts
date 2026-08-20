import { pool } from "../db/pool";
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
  params.push(filtro.limite ?? 200);
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
      data: String(r.data).slice(0, 10),
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
