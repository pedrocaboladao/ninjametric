import { pool } from "../db/pool";
import { listLojas, type Loja } from "./tokenStore";
import { listarItensAtivos, getItemsBasicInfo, getPriceToWin, getTaxaMlParaPreco } from "./mercadoLivreApi";
import { listarProdutos } from "./produtosService";
import { normalizarSku } from "./financeiroService";

// Só as 4 contas PESSOAIS do usuário — mesmo escopo do Analista de Ads e do
// Agente de Oportunidades (ver LOJAS_AGENTE em agenteAdsService.ts).
const LOJAS_AGENTE = [1, 2, 3, 4];

async function comConcorrenciaLimitada<T, R>(itens: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(itens.length);
  let indice = 0;
  async function worker() {
    while (indice < itens.length) {
      const i = indice++;
      resultados[i] = await fn(itens[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, worker));
  return resultados;
}

// Margem = preço - custo cadastrado - taxa real do ML naquele preço
// (categoria + tipo de anúncio) - imposto da loja. Null se faltar custo
// cadastrado ou não der pra calcular a taxa do ML (categoria/tipo ausente).
function calcularMargem(
  preco: number,
  custoUnitario: number | null,
  taxaMl: number | null,
  impostoPercentual: number
): number | null {
  if (custoUnitario === null || taxaMl === null) return null;
  const imposto = preco * (impostoPercentual / 100);
  return preco - custoUnitario - taxaMl - imposto;
}

async function capturarCatalogoDaLoja(loja: Loja, custoPorSku: Map<string, number>): Promise<void> {
  const itemIds = await listarItensAtivos(loja.id, loja.ml_user_id as number);
  const itens = await getItemsBasicInfo(loja.id, itemIds);
  const itensCatalogo = Array.from(itens.values()).filter((i) => i.catalog_listing === true);

  const linhas = await comConcorrenciaLimitada(itensCatalogo, 10, async (item) => {
    const detalhe = await getPriceToWin(loja.id, item.id);
    if (!detalhe || detalhe.status === "winning" || detalhe.priceToWin === null) return null;

    const skuNorm = item.seller_custom_field ? normalizarSku(item.seller_custom_field) : null;
    const custoUnitario = skuNorm !== null ? (custoPorSku.get(skuNorm) ?? null) : null;

    let taxaMlAtual: number | null = null;
    let taxaMlNoPriceToWin: number | null = null;
    if (item.category_id && item.listing_type_id) {
      [taxaMlAtual, taxaMlNoPriceToWin] = await Promise.all([
        getTaxaMlParaPreco(loja.id, item.category_id, item.listing_type_id, detalhe.currentPrice),
        getTaxaMlParaPreco(loja.id, item.category_id, item.listing_type_id, detalhe.priceToWin),
      ]);
    }

    return {
      itemId: item.id,
      titulo: item.title,
      thumbnail: item.thumbnail ?? null,
      permalink: item.permalink ?? null,
      status: detalhe.status,
      precoAtual: detalhe.currentPrice,
      priceToWin: detalhe.priceToWin,
      sku: item.seller_custom_field ?? null,
      custoUnitario,
      margemAtual: calcularMargem(detalhe.currentPrice, custoUnitario, taxaMlAtual, loja.imposto_percentual),
      margemNoPriceToWin: calcularMargem(detalhe.priceToWin, custoUnitario, taxaMlNoPriceToWin, loja.imposto_percentual),
    };
  });

  const validas = linhas.filter((l): l is NonNullable<typeof l> => l !== null);

  for (const l of validas) {
    await pool.query(
      `INSERT INTO agente_catalogo_snapshot
         (loja_id, item_id, titulo, thumbnail, permalink, status, preco_atual, price_to_win, sku,
          custo_unitario, margem_atual, margem_no_price_to_win, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
       ON CONFLICT (loja_id, item_id) DO UPDATE SET
         titulo = EXCLUDED.titulo, thumbnail = EXCLUDED.thumbnail, permalink = EXCLUDED.permalink,
         status = EXCLUDED.status, preco_atual = EXCLUDED.preco_atual, price_to_win = EXCLUDED.price_to_win,
         sku = EXCLUDED.sku, custo_unitario = EXCLUDED.custo_unitario, margem_atual = EXCLUDED.margem_atual,
         margem_no_price_to_win = EXCLUDED.margem_no_price_to_win, atualizado_em = now()`,
      [
        loja.id,
        l.itemId,
        l.titulo,
        l.thumbnail,
        l.permalink,
        l.status,
        l.precoAtual,
        l.priceToWin,
        l.sku,
        l.custoUnitario,
        l.margemAtual,
        l.margemNoPriceToWin,
      ]
    );
  }

  await pool.query("DELETE FROM agente_catalogo_snapshot WHERE loja_id = $1 AND item_id != ALL($2::text[])", [
    loja.id,
    validas.map((l) => l.itemId),
  ]);
}

export async function capturarCatalogoDeTodasLojas(): Promise<void> {
  const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null && LOJAS_AGENTE.includes(l.id));
  const produtos = await listarProdutos();
  const custoPorSku = new Map(produtos.map((p) => [normalizarSku(p.sku), p.custo]));

  for (const loja of lojas) {
    try {
      await capturarCatalogoDaLoja(loja, custoPorSku);
    } catch (err) {
      console.error(`Agente de Catálogo: falha ao capturar a loja ${loja.id}:`, err);
    }
  }
}

const INTERVALO_MS = 4 * 60 * 60 * 1000; // 4h, mesmo ritmo do estoque/vendas negativas

export function iniciarSnapshotCatalogo(): void {
  capturarCatalogoDeTodasLojas()
    .then(() => console.log("Snapshot do Agente de Catálogo concluído."))
    .catch((err) => console.error("Erro no snapshot inicial do Agente de Catálogo:", err));
  setInterval(() => {
    capturarCatalogoDeTodasLojas()
      .then(() => console.log("Snapshot do Agente de Catálogo concluído."))
      .catch((err) => console.error("Erro no snapshot periódico do Agente de Catálogo:", err));
  }, INTERVALO_MS);
}

export interface ItemCatalogo {
  lojaId: number;
  lojaNome: string;
  itemId: string;
  titulo: string;
  thumbnail: string | null;
  permalink: string | null;
  status: string;
  precoAtual: number;
  priceToWin: number | null;
  sku: string | null;
  custoUnitario: number | null;
  margemAtual: number | null;
  margemNoPriceToWin: number | null;
  atualizadoEm: string;
}

export async function listarCatalogo(lojaId?: number, lojasPermitidas?: number[]): Promise<ItemCatalogo[]> {
  const condicoes: string[] = [];
  const params: (number | number[])[] = [];

  if (lojaId !== undefined) {
    params.push(lojaId);
    condicoes.push(`c.loja_id = $${params.length}`);
  } else if (lojasPermitidas !== undefined) {
    params.push(lojasPermitidas);
    condicoes.push(`c.loja_id = ANY($${params.length}::int[])`);
  }

  const { rows } = await pool.query<{
    loja_id: number;
    loja_nome: string;
    item_id: string;
    titulo: string;
    thumbnail: string | null;
    permalink: string | null;
    status: string;
    preco_atual: string;
    price_to_win: string | null;
    sku: string | null;
    custo_unitario: string | null;
    margem_atual: string | null;
    margem_no_price_to_win: string | null;
    atualizado_em: string;
  }>(
    `SELECT c.loja_id, l.nome AS loja_nome, c.item_id, c.titulo, c.thumbnail, c.permalink, c.status,
            c.preco_atual, c.price_to_win, c.sku, c.custo_unitario, c.margem_atual, c.margem_no_price_to_win,
            c.atualizado_em
     FROM agente_catalogo_snapshot c
     JOIN lojas l ON l.id = c.loja_id
     ${condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : ""}
     ORDER BY c.margem_no_price_to_win DESC NULLS LAST
     LIMIT 300`,
    params
  );

  return rows.map((r) => ({
    lojaId: r.loja_id,
    lojaNome: r.loja_nome,
    itemId: r.item_id,
    titulo: r.titulo,
    thumbnail: r.thumbnail,
    permalink: r.permalink,
    status: r.status,
    precoAtual: Number(r.preco_atual),
    priceToWin: r.price_to_win !== null ? Number(r.price_to_win) : null,
    sku: r.sku,
    custoUnitario: r.custo_unitario !== null ? Number(r.custo_unitario) : null,
    margemAtual: r.margem_atual !== null ? Number(r.margem_atual) : null,
    margemNoPriceToWin: r.margem_no_price_to_win !== null ? Number(r.margem_no_price_to_win) : null,
    atualizadoEm: r.atualizado_em,
  }));
}
