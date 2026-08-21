import { pool } from "../db/pool";
import { dataIso, dataIsoOuNulo } from "./fabricaData";
import { listarProdutos } from "./fabricaProdutosService";

// Devolução — o caminho de volta da mercadoria.
//
// Fábrica → vende → loja → cliente final. O cliente não quis, não estava em
// casa ou o pedido extraviou, e o produto volta pra loja e da loja pra cá.
// Acontece com todas as 21, toda semana.
//
// Três finais possíveis, e eles não são a mesma coisa nem no estoque nem no
// dinheiro:
//
//   BOM        volta pro estoque de produto acabado e a loja ganha crédito
//   ESTOURADO  vazou; embalagem descartada, produto perdido
//   QUEBRADO   trincado com tinta dentro; a tinta vai pros tambores
//
// Só o BOM gera crédito por padrão. No estourado e no quebrado a loja pede
// ressarcimento ao Mercado Livre e recebe direto na conta dela — dar crédito
// também faria a loja receber duas vezes pelo mesmo produto.

export type CondicaoDevolucao = "BOM" | "ESTOURADO" | "QUEBRADO";

export const CONDICOES: CondicaoDevolucao[] = ["BOM", "ESTOURADO", "QUEBRADO"];

// O funcionário manda foto pro ML e pede ressarcimento pela avaria. O dinheiro
// cai na conta da LOJA, não da fábrica — a venda no ML era dela. Então isto não
// é receita da fábrica: é o controle de quanto a loja foi coberta, que é o que
// decide se ela ainda merece crédito.
export type StatusRessarcimento = "NAO_PEDIDO" | "PEDIDO" | "RECEBIDO" | "NEGADO";

export const STATUS_RESSARCIMENTO: StatusRessarcimento[] = [
  "NAO_PEDIDO",
  "PEDIDO",
  "RECEBIDO",
  "NEGADO",
];

export interface Devolucao {
  id: number;
  clienteId: number;
  clienteNome: string;
  produtoId: number;
  produtoSku: string;
  produtoNome: string;
  data: string;
  quantidade: number;
  condicao: CondicaoDevolucao;
  credito: number;
  custoUnitario: number;
  notaFiscal: string | null;
  notaCancelada: boolean;
  ressarcimentoStatus: StatusRessarcimento;
  ressarcimentoValor: number;
  ressarcimentoData: string | null;
  ressarcimentoProtocolo: string | null;
  recebidoPor: string | null;
  observacao: string | null;
  // derivados
  voltouAoEstoque: boolean;
  custoTotal: number;
  // quanto a mercadoria valia pra loja, pelo preco que ela pagou
  valorDaMercadoria: number;
  // o que sobrou descoberto: nem o ML pagou, nem a fabrica creditou
  descoberto: number;
}

export interface DevolucaoEntrada {
  clienteId: number;
  produtoId: number;
  data: string | null;
  quantidade: number;
  condicao: CondicaoDevolucao;
  // quando não vem, usa o padrão: preço de venda no BOM, zero no avariado
  credito?: number | null;
  notaFiscal: string | null;
  recebidoPor: string | null;
  observacao: string | null;
}

interface Linha {
  id: number;
  cliente_id: number;
  cliente_nome: string;
  produto_id: number;
  sku: string;
  produto_nome: string;
  data: string;
  quantidade: string;
  condicao: string;
  credito: string;
  custo_unitario: string;
  preco_venda: string;
  nota_fiscal: string | null;
  nota_cancelada: boolean;
  ressarcimento_status: string;
  ressarcimento_valor: string;
  ressarcimento_data: string | null;
  ressarcimento_protocolo: string | null;
  recebido_por: string | null;
  observacao: string | null;
}

function montar(r: Linha): Devolucao {
  const condicao = (CONDICOES.includes(r.condicao as CondicaoDevolucao)
    ? r.condicao
    : "BOM") as CondicaoDevolucao;
  const quantidade = Number(r.quantidade);
  const custoUnitario = Number(r.custo_unitario);
  const credito = Number(r.credito);
  const ressarcimentoValor = Number(r.ressarcimento_valor);
  // preço atual do cadastro: é a melhor referência disponível do que a loja
  // pagou, já que a devolução não aponta pra um pedido específico
  const valorDaMercadoria = Number(r.preco_venda) * quantidade;
  return {
    id: r.id,
    clienteId: r.cliente_id,
    clienteNome: r.cliente_nome,
    produtoId: r.produto_id,
    produtoSku: r.sku,
    produtoNome: r.produto_nome,
    data: dataIso(r.data),
    quantidade,
    condicao,
    credito,
    custoUnitario,
    notaFiscal: r.nota_fiscal,
    notaCancelada: r.nota_cancelada,
    ressarcimentoStatus: (STATUS_RESSARCIMENTO.includes(
      r.ressarcimento_status as StatusRessarcimento
    )
      ? r.ressarcimento_status
      : "NAO_PEDIDO") as StatusRessarcimento,
    ressarcimentoValor,
    ressarcimentoData: dataIsoOuNulo(r.ressarcimento_data),
    ressarcimentoProtocolo: r.ressarcimento_protocolo,
    recebidoPor: r.recebido_por,
    observacao: r.observacao,
    // só o produto inteiro volta pra prateleira: estourado virou lixo e
    // quebrado virou tinta a granel
    voltouAoEstoque: condicao === "BOM",
    custoTotal: quantidade * custoUnitario,
    valorDaMercadoria,
    // nunca negativo: ML pagando mais que o valor da mercadoria e sobra da
    // loja, não dívida da fábrica
    descoberto: Math.max(0, valorDaMercadoria - ressarcimentoValor - credito),
  };
}

export interface FiltroDevolucoes {
  clienteId?: number;
  condicao?: CondicaoDevolucao;
  de?: string;
  ate?: string;
  limite?: number;
}

export async function listarDevolucoes(filtro: FiltroDevolucoes = {}): Promise<Devolucao[]> {
  const condicoes: string[] = [];
  const params: unknown[] = [];
  if (filtro.clienteId) {
    params.push(filtro.clienteId);
    condicoes.push(`d.cliente_id = $${params.length}`);
  }
  if (filtro.condicao) {
    params.push(filtro.condicao);
    condicoes.push(`d.condicao = $${params.length}`);
  }
  if (filtro.de) {
    params.push(filtro.de);
    condicoes.push(`d.data >= $${params.length}::date`);
  }
  if (filtro.ate) {
    params.push(filtro.ate);
    condicoes.push(`d.data <= $${params.length}::date`);
  }
  params.push(filtro.limite ?? 200);
  const where = condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : "";

  const { rows } = await pool.query<Linha>(
    `SELECT d.id, d.cliente_id, c.nome AS cliente_nome,
            d.produto_id, pr.sku, pr.nome AS produto_nome,
            d.data, d.quantidade, d.condicao, d.credito, d.custo_unitario,
            d.nota_fiscal, d.nota_cancelada, d.recebido_por, d.observacao,
            d.ressarcimento_status, d.ressarcimento_valor, d.ressarcimento_data,
            d.ressarcimento_protocolo, pr.preco_venda
     FROM fabrica_devolucoes d
     JOIN fabrica_clientes c ON c.id = d.cliente_id
     JOIN fabrica_produtos pr ON pr.id = d.produto_id
     ${where}
     ORDER BY d.data DESC, d.id DESC
     LIMIT $${params.length}`,
    params
  );
  return rows.map(montar);
}

export async function registrarDevolucao(e: DevolucaoEntrada): Promise<{ id: number }> {
  if (!Number.isInteger(e.clienteId) || e.clienteId <= 0) throw new Error("Escolha a loja.");
  if (!Number.isInteger(e.produtoId) || e.produtoId <= 0) throw new Error("Escolha o produto.");
  if (!Number.isFinite(e.quantidade) || e.quantidade <= 0) {
    throw new Error("Quantidade deve ser maior que zero.");
  }

  const produtos = await listarProdutos();
  const produto = produtos.find((p) => p.id === e.produtoId);
  if (!produto) throw new Error("Produto não encontrado.");

  // padrão: valor cheio no BOM, zero no avariado. Fica editável porque caso a
  // caso muda, e uma regra rígida obrigaria a mentir a condição pra conseguir
  // o valor certo.
  const credito =
    e.credito !== undefined && e.credito !== null && Number.isFinite(e.credito)
      ? Number(e.credito)
      : e.condicao === "BOM"
        ? produto.precoVenda * e.quantidade
        : 0;

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO fabrica_devolucoes
       (cliente_id, produto_id, data, quantidade, condicao, credito, custo_unitario,
        nota_fiscal, recebido_por, observacao)
     VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      e.clienteId,
      e.produtoId,
      e.data,
      e.quantidade,
      e.condicao,
      credito,
      produto.custo,
      e.notaFiscal,
      e.recebidoPor,
      e.observacao,
    ]
  );
  return { id: rows[0].id };
}

// Cancelar a nota e uma acao de fora do sistema — quem cancela e o emissor.
// Aqui so se marca que foi feito, pra pendencia sair da lista.
// Lancado depois, quando o ML responde. Fica separado do cadastro da devolucao
// porque a resposta chega dias depois e quem lanca pode ser outra pessoa.
export async function registrarRessarcimento(
  id: number,
  status: StatusRessarcimento,
  valor: number,
  data: string | null,
  protocolo: string | null
): Promise<void> {
  await pool.query(
    `UPDATE fabrica_devolucoes
     SET ressarcimento_status = $2,
         -- negado ou nao pedido nao tem valor: guardar um numero ali faria o
         -- consolidado somar dinheiro que nunca entrou
         ressarcimento_valor = CASE WHEN $2 = 'RECEBIDO' THEN $3 ELSE 0 END,
         ressarcimento_data = $4::date,
         ressarcimento_protocolo = $5
     WHERE id = $1`,
    [id, status, valor, data, protocolo]
  );
}

export async function definirCredito(id: number, credito: number): Promise<void> {
  await pool.query("UPDATE fabrica_devolucoes SET credito = $2 WHERE id = $1", [id, credito]);
}

export interface ConsolidadoRessarcimento {
  avarias: number;
  valorAvariado: number;
  naoPedido: number;
  pedido: number;
  recebido: number;
  negado: number;
  recebidoValor: number;
  creditoDado: number;
  descoberto: number;
}

// Consolidado do que a fabrica precisa cobrar do Mercado Livre e do que ja
// entrou. E o painel que o funcionario olha pra saber o que falta correr atras.
export async function consolidadoRessarcimento(
  de?: string,
  ate?: string
): Promise<ConsolidadoRessarcimento> {
  const devolucoes = await listarDevolucoes({ de, ate, limite: 5000 });
  const avariadas = devolucoes.filter((d) => d.condicao !== "BOM");
  const contar = (s: StatusRessarcimento) =>
    avariadas.filter((d) => d.ressarcimentoStatus === s).length;

  return {
    avarias: avariadas.length,
    valorAvariado: avariadas.reduce((s, d) => s + d.valorDaMercadoria, 0),
    naoPedido: contar("NAO_PEDIDO"),
    pedido: contar("PEDIDO"),
    recebido: contar("RECEBIDO"),
    negado: contar("NEGADO"),
    recebidoValor: avariadas.reduce((s, d) => s + d.ressarcimentoValor, 0),
    creditoDado: avariadas.reduce((s, d) => s + d.credito, 0),
    descoberto: avariadas.reduce((s, d) => s + d.descoberto, 0),
  };
}

export async function marcarNotaCancelada(id: number, cancelada: boolean): Promise<void> {
  await pool.query("UPDATE fabrica_devolucoes SET nota_cancelada = $2 WHERE id = $1", [
    id,
    cancelada,
  ]);
}

export async function notasPendentes(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    "SELECT COUNT(*) AS n FROM fabrica_devolucoes WHERE NOT nota_cancelada"
  );
  return Number(rows[0].n);
}

export async function excluirDevolucao(id: number): Promise<void> {
  await pool.query("DELETE FROM fabrica_devolucoes WHERE id = $1", [id]);
}

// --- efeitos em outras telas -------------------------------------------------

// Quanto voltou pra prateleira de cada produto. Só o que chegou inteiro.
export async function retornoPorProduto(): Promise<Map<number, number>> {
  const { rows } = await pool.query<{ produto_id: number; total: string }>(
    `SELECT produto_id, SUM(quantidade) AS total
     FROM fabrica_devolucoes WHERE condicao = 'BOM' GROUP BY produto_id`
  );
  return new Map(rows.map((r) => [r.produto_id, Number(r.total)]));
}

// Crédito acumulado de cada loja — abate no que ela deve.
export async function creditoPorCliente(): Promise<Map<number, number>> {
  const { rows } = await pool.query<{ cliente_id: number; total: string }>(
    "SELECT cliente_id, SUM(credito) AS total FROM fabrica_devolucoes GROUP BY cliente_id"
  );
  return new Map(rows.map((r) => [r.cliente_id, Number(r.total)]));
}

// Devoluções do período pro DRE: o crédito reduz a receita e o custo do que
// voltou inteiro reduz o CPV — o produto está de volta na prateleira, não foi
// vendido de verdade.
export async function totaisDoPeriodo(
  de: string,
  ate: string
): Promise<{ credito: number; custoRetornado: number; unidades: number; perdidas: number }> {
  const { rows } = await pool.query<{
    credito: string;
    custo_retornado: string;
    unidades: string;
    perdidas: string;
  }>(
    `SELECT COALESCE(SUM(credito), 0) AS credito,
            COALESCE(SUM(CASE WHEN condicao = 'BOM'
                              THEN quantidade * custo_unitario ELSE 0 END), 0) AS custo_retornado,
            COALESCE(SUM(quantidade), 0) AS unidades,
            COALESCE(SUM(CASE WHEN condicao <> 'BOM' THEN quantidade ELSE 0 END), 0) AS perdidas
     FROM fabrica_devolucoes
     WHERE data >= $1::date AND data <= $2::date`,
    [de, ate]
  );
  const r = rows[0];
  return {
    credito: Number(r.credito),
    custoRetornado: Number(r.custo_retornado),
    unidades: Number(r.unidades),
    perdidas: Number(r.perdidas),
  };
}
