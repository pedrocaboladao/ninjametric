import { pool } from "../db/pool";
import { lancarEstoque, estoqueDoPedido } from "./blingProdutosService";
import { listarPedidos } from "./blingPedidosService";

/**
 * A carga que faz o CMV aparecer no DRE do Bling — sem nota fiscal.
 *
 * A fórmula do relatório, textual da documentação do Bling:
 *
 *   CMV = (soma das saídas de estoque) x (preço da última compra)
 *
 * e "preço da última compra" é o Preço ou Custo da última movimentação do tipo
 * **Entrada ou Balanço**, com valor maior que zero, existente no período. Só
 * contam saídas **com origem** — saída avulsa de estoque não entra (testado em
 * 24/09/2026, em depósito normal e em depósito com "desconsiderar saldo").
 *
 * Daí as duas metades desta rotina:
 *
 * 1. `semearCustos` — um balanço por produto, quantidade zero, com o custo. É
 *    o carimbo de preço. Produto sem ele entra no CMV **zerado**, e nada avisa:
 *    no teste do pedido 4425 o RESIFLEX-12KG-CINZA contribuiu R$ 0,00.
 * 2. `lancarPedidos` — a saída com origem, pedido a pedido.
 *
 * Quantidade zero no balanço é de propósito: o CMV usa só o preço da
 * movimentação, nunca a quantidade, então não é preciso inventar estoque.
 */

/** O depósito padrão da fábrica. As saídas dos pedidos caem nele. */
export const DEPOSITO_PADRAO = 14888997066;

export interface LinhaSemeada {
  sku: string;
  custo: number;
  ok: boolean;
  estoqueId?: number;
  erro?: string;
}

export async function semearCustos(
  pares: Array<{ sku: string; custo: number }>,
  simulacao: boolean,
  aoAndar?: (feitos: number, total: number) => void
): Promise<{ simulacao: boolean; linhas: LinhaSemeada[] }> {
  const linhas: LinhaSemeada[] = [];
  for (let i = 0; i < pares.length; i++) {
    const { sku, custo } = pares[i];
    // custo zero não serve: a documentação exige valor maior que zero pra
    // movimentação virar referência de preço. Semear zero seria o mesmo que
    // não semear, mas parecendo feito.
    if (!(custo > 0)) {
      linhas.push({ sku, custo, ok: false, erro: "custo zero ou negativo" });
      if (aoAndar) aoAndar(i + 1, pares.length);
      continue;
    }
    try {
      const r = (await lancarEstoque({
        sku,
        operacao: "B",
        quantidade: 0,
        preco: custo,
        custo,
        depositoId: DEPOSITO_PADRAO,
        observacoes: "Custo para o CMV do DRE — carga automatica",
        simulacao,
      })) as { erro?: string; estoqueId?: number };
      if (r?.erro) linhas.push({ sku, custo, ok: false, erro: r.erro });
      else linhas.push({ sku, custo, ok: true, estoqueId: r?.estoqueId });
    } catch (err) {
      linhas.push({
        sku, custo, ok: false,
        erro: err instanceof Error ? err.message : "falha ao semear",
      });
    }
    if (aoAndar) aoAndar(i + 1, pares.length);
  }
  return { simulacao, linhas };
}

export interface LinhaPedido {
  id: number;
  numero: string;
  data: string;
  situacao: "lancado" | "ja estava" | "erro";
  erro?: string;
}

/**
 * Lança o estoque dos pedidos do período, pulando o que já foi lançado.
 *
 * A trava de duplicidade é a tabela, não a resposta do Bling: ele aceita
 * lançar duas vezes sem reclamar, e o CMV do mês dobraria em silêncio.
 */
export async function lancarPedidos(
  de: string,
  ate: string,
  simulacao: boolean,
  aoAndar?: (feitos: number, total: number) => void
): Promise<{ simulacao: boolean; total: number; linhas: LinhaPedido[] }> {
  const pedidos = await listarPedidos(de, ate);
  const { rows } = await pool.query<{ bling_pedido_id: string }>(
    `SELECT bling_pedido_id FROM fabrica_bling_estoque_pedido WHERE estornado_em IS NULL`
  );
  const feitos = new Set(rows.map((r) => String(r.bling_pedido_id)));

  const linhas: LinhaPedido[] = [];
  for (let i = 0; i < pedidos.length; i++) {
    const p = pedidos[i];
    const base = { id: p.id, numero: p.numero, data: p.data };
    if (feitos.has(String(p.id))) {
      linhas.push({ ...base, situacao: "ja estava" });
      if (aoAndar) aoAndar(i + 1, pedidos.length);
      continue;
    }
    if (simulacao) {
      linhas.push({ ...base, situacao: "lancado" });
      if (aoAndar) aoAndar(i + 1, pedidos.length);
      continue;
    }
    try {
      await estoqueDoPedido(p.id, "lancar");
      // grava ANTES de seguir: se o processo morrer no meio, o que já foi
      // lançado não é lançado de novo na próxima passada
      await pool.query(
        `INSERT INTO fabrica_bling_estoque_pedido (bling_pedido_id, numero, data)
         VALUES ($1, $2, $3::date)
         ON CONFLICT (bling_pedido_id)
         DO UPDATE SET lancado_em = now(), estornado_em = NULL`,
        [p.id, p.numero, p.data]
      );
      linhas.push({ ...base, situacao: "lancado" });
    } catch (err) {
      linhas.push({
        ...base, situacao: "erro",
        erro: err instanceof Error ? err.message : "falha ao lançar",
      });
    }
    if (aoAndar) aoAndar(i + 1, pedidos.length);
  }
  return { simulacao, total: pedidos.length, linhas };
}

/** Desfaz o lançamento de um pedido. O par de `lancarPedidos`, pra voltar atrás. */
export async function estornarPedido(idPedido: number): Promise<unknown> {
  const r = await estoqueDoPedido(idPedido, "estornar");
  await pool.query(
    `UPDATE fabrica_bling_estoque_pedido SET estornado_em = now() WHERE bling_pedido_id = $1`,
    [idPedido]
  );
  return r;
}

/** O que já foi lançado, pra conferir sem depender do Bling. */
export async function pedidosLancados(de: string, ate: string): Promise<unknown[]> {
  const { rows } = await pool.query(
    `SELECT bling_pedido_id::text AS "blingPedidoId", numero, data::text AS data,
            lancado_em AS "lancadoEm", estornado_em AS "estornadoEm"
       FROM fabrica_bling_estoque_pedido
      WHERE data BETWEEN $1::date AND $2::date
      ORDER BY data, numero`,
    [de, ate]
  );
  return rows;
}
