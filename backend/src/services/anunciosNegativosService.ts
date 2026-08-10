import { pool } from "../db/pool";
import { listLojas, type Loja } from "./tokenStore";
import { listarItensAtivos, getItemsBasicInfo, getTaxaMlParaPreco, getPromocaoAtivaDoItem } from "./mercadoLivreApi";
import { listarProdutos } from "./produtosService";
import { normalizarSku } from "./financeiroService";
import { calcularMargem } from "./agenteCatalogoService";

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

interface AnuncioNegativoInterno {
  itemId: string;
  titulo: string;
  thumbnail: string | null;
  permalink: string | null;
  sku: string | null;
  precoEfetivo: number;
  emPromocao: boolean;
  custoUnitario: number;
  taxaMl: number;
  margemEstimada: number;
  margemPercentual: number;
}

// Só checa anúncios com custo cadastrado (sem custo não dá pra saber se é
// negativo) — filtro que já derruba a maioria do volume antes de gastar
// chamada de API com promoção/taxa ML. Preço efetivo = deal_price da
// promoção ativa, se tiver, senão o preço normal do anúncio — é a mesma
// ideia do "entrou em promoção e comeu a margem" que motivou essa tela.
async function coletarAnunciosNegativosDaLoja(loja: Loja, custoPorSku: Map<string, number>): Promise<AnuncioNegativoInterno[]> {
  const itemIds = await listarItensAtivos(loja.id, loja.ml_user_id as number);
  const itens = await getItemsBasicInfo(loja.id, itemIds);

  const candidatos = Array.from(itens.values()).filter((item) => {
    const skuNorm = item.seller_custom_field ? normalizarSku(item.seller_custom_field) : null;
    return skuNorm !== null && custoPorSku.has(skuNorm) && item.category_id && item.listing_type_id;
  });

  const linhas = await comConcorrenciaLimitada(candidatos, 10, async (item) => {
    const skuNorm = normalizarSku(item.seller_custom_field as string);
    const custoUnitario = custoPorSku.get(skuNorm) as number;

    const promo = await getPromocaoAtivaDoItem(loja.id, item.id);
    const precoEfetivo = promo.ativa && promo.precoPromocional !== null ? promo.precoPromocional : item.price;

    const taxaMl = await getTaxaMlParaPreco(loja.id, item.category_id as string, item.listing_type_id as string, precoEfetivo);
    const margem = calcularMargem(precoEfetivo, custoUnitario, taxaMl, loja.imposto_percentual);
    if (margem === null || margem >= 0 || taxaMl === null) return null;

    return {
      itemId: item.id,
      titulo: item.title,
      thumbnail: item.thumbnail ?? null,
      permalink: item.permalink ?? null,
      sku: item.seller_custom_field ?? null,
      precoEfetivo,
      emPromocao: promo.ativa,
      custoUnitario,
      taxaMl,
      margemEstimada: margem,
      margemPercentual: (margem / precoEfetivo) * 100,
    };
  });

  return linhas.filter((l): l is NonNullable<typeof l> => l !== null);
}

async function gravarSnapshot(lojaId: number, itens: AnuncioNegativoInterno[]): Promise<void> {
  await pool.query("DELETE FROM anuncios_negativos_snapshot WHERE loja_id = $1", [lojaId]);
  for (const l of itens) {
    await pool.query(
      `INSERT INTO anuncios_negativos_snapshot
         (loja_id, item_id, titulo, thumbnail, permalink, sku, preco_efetivo, em_promocao,
          custo_unitario, taxa_ml, margem_estimada, margem_percentual, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
       ON CONFLICT (loja_id, item_id) DO UPDATE SET
         titulo = EXCLUDED.titulo, thumbnail = EXCLUDED.thumbnail, permalink = EXCLUDED.permalink,
         sku = EXCLUDED.sku, preco_efetivo = EXCLUDED.preco_efetivo, em_promocao = EXCLUDED.em_promocao,
         custo_unitario = EXCLUDED.custo_unitario, taxa_ml = EXCLUDED.taxa_ml,
         margem_estimada = EXCLUDED.margem_estimada, margem_percentual = EXCLUDED.margem_percentual,
         atualizado_em = now()`,
      [
        lojaId,
        l.itemId,
        l.titulo,
        l.thumbnail,
        l.permalink,
        l.sku,
        l.precoEfetivo,
        l.emPromocao,
        l.custoUnitario,
        l.taxaMl,
        l.margemEstimada,
        l.margemPercentual,
      ]
    );
  }
}

export async function capturarAnunciosNegativos(): Promise<void> {
  const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null);
  const produtos = await listarProdutos();
  const custoPorSku = new Map(produtos.map((p) => [normalizarSku(p.sku), p.custo]));

  for (const loja of lojas) {
    try {
      const itens = await coletarAnunciosNegativosDaLoja(loja, custoPorSku);
      await gravarSnapshot(loja.id, itens);
    } catch (err) {
      console.error(`Anúncios com margem negativa: falha ao checar a loja ${loja.id}, pulando essa loja:`, err);
    }
  }
}

const INTERVALO_MS = 4 * 60 * 60 * 1000; // 4h, mesmo ritmo do estoque/vendas negativas/catálogo

export function iniciarSnapshotAnunciosNegativos(): void {
  capturarAnunciosNegativos()
    .then(() => console.log("Snapshot de anúncios com margem negativa concluído."))
    .catch((err) => console.error("Erro no snapshot inicial de anúncios com margem negativa:", err));
  setInterval(() => {
    capturarAnunciosNegativos()
      .then(() => console.log("Snapshot de anúncios com margem negativa concluído."))
      .catch((err) => console.error("Erro no snapshot periódico de anúncios com margem negativa:", err));
  }, INTERVALO_MS);
}

export interface AnuncioNegativo {
  lojaId: number;
  lojaNome: string;
  itemId: string;
  titulo: string;
  thumbnail: string | null;
  permalink: string | null;
  sku: string | null;
  precoEfetivo: number;
  emPromocao: boolean;
  custoUnitario: number;
  taxaMl: number;
  margemEstimada: number;
  margemPercentual: number;
  atualizadoEm: string;
}

export async function listarAnunciosNegativos(lojaId?: number, lojasPermitidas?: number[]): Promise<AnuncioNegativo[]> {
  const condicoes: string[] = [];
  const params: (number | number[])[] = [];

  if (lojaId !== undefined) {
    params.push(lojaId);
    condicoes.push(`a.loja_id = $${params.length}`);
  } else if (lojasPermitidas !== undefined) {
    params.push(lojasPermitidas);
    condicoes.push(`a.loja_id = ANY($${params.length}::int[])`);
  }

  const { rows } = await pool.query<{
    loja_id: number;
    loja_nome: string;
    item_id: string;
    titulo: string;
    thumbnail: string | null;
    permalink: string | null;
    sku: string | null;
    preco_efetivo: string;
    em_promocao: boolean;
    custo_unitario: string;
    taxa_ml: string;
    margem_estimada: string;
    margem_percentual: string;
    atualizado_em: string;
  }>(
    `SELECT a.loja_id, l.nome AS loja_nome, a.item_id, a.titulo, a.thumbnail, a.permalink, a.sku,
            a.preco_efetivo, a.em_promocao, a.custo_unitario, a.taxa_ml, a.margem_estimada,
            a.margem_percentual, a.atualizado_em
     FROM anuncios_negativos_snapshot a
     JOIN lojas l ON l.id = a.loja_id
     ${condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : ""}
     ORDER BY a.margem_estimada ASC
     LIMIT 500`,
    params
  );

  return rows.map((r) => ({
    lojaId: r.loja_id,
    lojaNome: r.loja_nome,
    itemId: r.item_id,
    titulo: r.titulo,
    thumbnail: r.thumbnail,
    permalink: r.permalink,
    sku: r.sku,
    precoEfetivo: Number(r.preco_efetivo),
    emPromocao: r.em_promocao,
    custoUnitario: Number(r.custo_unitario),
    taxaMl: Number(r.taxa_ml),
    margemEstimada: Number(r.margem_estimada),
    margemPercentual: Number(r.margem_percentual),
    atualizadoEm: r.atualizado_em,
  }));
}

export async function contarAnunciosNegativos(lojaIds: number[]): Promise<number> {
  const { rows } = await pool.query<{ total: string }>(
    "SELECT COUNT(*) AS total FROM anuncios_negativos_snapshot WHERE loja_id = ANY($1::int[])",
    [lojaIds]
  );
  return Number(rows[0]?.total ?? 0);
}
