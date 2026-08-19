import { pool } from "../db/pool";
import { env } from "../config/env";
import { GeckoProvider } from "../providers/GeckoProvider";
import type { MarketProvider } from "../providers/MarketProvider";
import { marcarColetada, obterKeyword } from "./keywordsService";

const provider: MarketProvider = new GeckoProvider();

interface ItemProprio {
  item_id: string;
  seller_id: string;
  store_name: string;
}

// Busca a lista de item_id das lojas próprias no ml-core — nunca token,
// nunca sessão, só essa chamada interna com a chave de serviço. Falha aqui
// não pode derrubar a busca de mercado (só perde a marcação "sua loja").
async function buscarItensProprios(): Promise<ItemProprio[]> {
  try {
    const res = await fetch(`${env.mlCoreInternalUrl}/internal/public-ml-items`, {
      headers: { "X-Internal-Key": env.internalServiceKey },
      // Defesa extra — mesmo com o ml-core protegido contra travar essa
      // chamada, nunca deixar a busca de mercado esperar indefinidamente
      // por causa de um "bônus" (marcação de anúncio próprio).
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`ml-core /internal/public-ml-items respondeu ${res.status}`);
      return [];
    }
    return (await res.json()) as ItemProprio[];
  } catch (err) {
    console.error("Falha ao buscar itens próprios do ml-core:", err);
    return [];
  }
}

async function requisicoesHoje(): Promise<number> {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS total FROM provider_requests WHERE created_at >= date_trunc('day', now())"
  );
  return rows[0].total;
}

async function registrarRequisicao(keyword: string, ok: boolean, creditsUsed: number | null): Promise<void> {
  await pool.query(
    "INSERT INTO provider_requests (provider, keyword, credits_used, ok) VALUES ($1, $2, $3, $4)",
    [provider.name, keyword, creditsUsed, ok]
  );
}

export async function buscarAgora(keywordId: number): Promise<void> {
  const keyword = await obterKeyword(keywordId);
  if (!keyword) throw new Error("Keyword não encontrada.");

  const jaFeitas = await requisicoesHoje();
  if (jaFeitas >= env.marketMaxRequestsDay) {
    throw new Error(
      `Limite diário de ${env.marketMaxRequestsDay} buscas atingido — nenhuma chamada paga a mais foi feita hoje.`
    );
  }

  const [resultados, itensProprios] = await Promise.all([
    provider.searchProducts(keyword.keyword).catch(async (err) => {
      await registrarRequisicao(keyword.keyword, false, null);
      throw err;
    }),
    buscarItensProprios(),
  ]);

  await registrarRequisicao(keyword.keyword, true, resultados.length);

  const proprioPorItemId = new Map(itensProprios.map((i) => [i.item_id, i]));

  for (const r of resultados) {
    const proprio = proprioPorItemId.get(r.itemId);
    await pool.query(
      `INSERT INTO search_snapshots
        (keyword_id, position, item_id, title, seller_id, seller_name, price, original_price,
         rating, review_count, sold_quantity, shipping_type, is_full, official_store, is_catalog,
         sponsored, brand, url, provider, is_own_listing, own_store_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        keywordId,
        r.position,
        r.itemId,
        r.title,
        r.sellerId,
        r.sellerName,
        r.price,
        r.originalPrice,
        r.rating,
        r.reviewCount,
        r.soldQuantity,
        r.shippingType,
        r.isFull,
        r.officialStore,
        r.isCatalog,
        r.sponsored,
        r.brand,
        r.url,
        provider.name,
        !!proprio,
        proprio?.store_name ?? null,
      ]
    );
  }

  await marcarColetada(keywordId);
}

export interface SnapshotRow {
  collectedAt: string;
  position: number;
  itemId: string;
  title: string | null;
  sellerName: string | null;
  price: number | null;
  isOwnListing: boolean;
  ownStoreName: string | null;
}

export async function listarHistorico(keywordId: number, limite = 200): Promise<SnapshotRow[]> {
  const { rows } = await pool.query(
    `SELECT collected_at, position, item_id, title, seller_name, price, is_own_listing, own_store_name
     FROM search_snapshots WHERE keyword_id = $1
     ORDER BY collected_at DESC, position ASC LIMIT $2`,
    [keywordId, limite]
  );
  return rows.map((r) => ({
    collectedAt: r.collected_at,
    position: r.position,
    itemId: r.item_id,
    title: r.title,
    sellerName: r.seller_name,
    price: r.price === null ? null : Number(r.price),
    isOwnListing: r.is_own_listing,
    ownStoreName: r.own_store_name,
  }));
}

export interface MetricasKeyword {
  ultimaColeta: string | null;
  precoMedioAtual: number | null;
  melhorPosicaoPropria: number | null;
}

export async function calcularMetricas(keywordId: number): Promise<MetricasKeyword> {
  const { rows: ultimaRows } = await pool.query(
    "SELECT MAX(collected_at) AS ultima FROM search_snapshots WHERE keyword_id = $1",
    [keywordId]
  );
  const ultimaColeta: string | null = ultimaRows[0]?.ultima ?? null;
  if (!ultimaColeta) {
    return { ultimaColeta: null, precoMedioAtual: null, melhorPosicaoPropria: null };
  }

  const { rows } = await pool.query(
    `SELECT
       AVG(price) FILTER (WHERE price IS NOT NULL) AS preco_medio,
       MIN(position) FILTER (WHERE is_own_listing) AS melhor_posicao_propria
     FROM search_snapshots
     WHERE keyword_id = $1 AND collected_at = $2`,
    [keywordId, ultimaColeta]
  );

  return {
    ultimaColeta,
    precoMedioAtual: rows[0].preco_medio === null ? null : Number(rows[0].preco_medio),
    melhorPosicaoPropria: rows[0].melhor_posicao_propria,
  };
}
