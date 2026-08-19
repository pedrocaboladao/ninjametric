import { pool } from "../db/pool";
import { env } from "../config/env";
import { GeckoProvider } from "../providers/GeckoProvider";
import type { MarketProvider } from "../providers/MarketProvider";
import { marcarColetada, obterKeyword } from "./keywordsService";
import { resolverNomeCategoria, resolverNomesCategorias } from "./categoriesService";

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
      // por causa de um "bônus" (marcação de anúncio próprio). 30s porque
      // agora cobre as ~20 lojas do grupo, não só as 4 pessoais.
      signal: AbortSignal.timeout(30_000),
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
         sponsored, brand, url, provider, is_own_listing, own_store_name, category_id, domain_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
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
        r.categoryId,
        r.domainId,
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

// Peso por posição isolado numa função só — posição 1 pesa mais que
// posição 40. Fácil de trocar depois (ex: decaimento diferente) sem mexer
// no resto do cálculo.
function pesoPosicao(posicao: number): number {
  return 1 / posicao;
}

export interface CategoriaDisponivel {
  categoryId: string;
  nome: string | null;
  total: number;
}

// Categorias vistas na coleta mais recente de uma keyword — alimenta o
// filtro no frontend sem precisar conhecer a taxonomia do ML de antemão.
export async function listarCategoriasDisponiveis(keywordId: number): Promise<CategoriaDisponivel[]> {
  const { rows: ultimaRows } = await pool.query(
    "SELECT MAX(collected_at) AS ultima FROM search_snapshots WHERE keyword_id = $1",
    [keywordId]
  );
  const ultimaColeta: string | null = ultimaRows[0]?.ultima ?? null;
  if (!ultimaColeta) return [];

  const { rows } = await pool.query(
    `SELECT category_id, COUNT(*)::int AS total
     FROM search_snapshots
     WHERE keyword_id = $1 AND collected_at = $2 AND category_id IS NOT NULL
     GROUP BY category_id
     ORDER BY total DESC`,
    [keywordId, ultimaColeta]
  );

  const nomes = await resolverNomesCategorias(rows.map((r) => r.category_id));
  return rows.map((r) => ({
    categoryId: r.category_id,
    nome: nomes.get(r.category_id) ?? null,
    total: r.total,
  }));
}

export interface ShareMercado {
  categoriaId: string | null;
  categoriaNome: string | null;
  totalResultados: number;
  resultadosProprios: number;
  shareSimples: number;
  sharePonderado: number;
  lojasContribuintes: string[];
}

// Share de mercado da coleta mais recente de uma keyword — quanto do
// resultado de busca (opcionalmente filtrado por categoria) é ocupado
// pelas lojas do grupo. "Simples" = contagem; "ponderado" = dá mais peso
// pras posições mais altas (ver pesoPosicao acima).
export async function calcularShareMercado(keywordId: number, categoryId?: string): Promise<ShareMercado | null> {
  const { rows: ultimaRows } = await pool.query(
    "SELECT MAX(collected_at) AS ultima FROM search_snapshots WHERE keyword_id = $1",
    [keywordId]
  );
  const ultimaColeta: string | null = ultimaRows[0]?.ultima ?? null;
  if (!ultimaColeta) return null;

  const { rows } = await pool.query(
    `SELECT position, is_own_listing, own_store_name
     FROM search_snapshots
     WHERE keyword_id = $1 AND collected_at = $2 ${categoryId ? "AND category_id = $3" : ""}`,
    categoryId ? [keywordId, ultimaColeta, categoryId] : [keywordId, ultimaColeta]
  );

  const categoriaNome = categoryId ? await resolverNomeCategoria(categoryId) : null;

  if (rows.length === 0) {
    return {
      categoriaId: categoryId ?? null,
      categoriaNome,
      totalResultados: 0,
      resultadosProprios: 0,
      shareSimples: 0,
      sharePonderado: 0,
      lojasContribuintes: [],
    };
  }

  let pesoTotal = 0;
  let pesoProprio = 0;
  let proprios = 0;
  const lojas = new Set<string>();

  for (const r of rows) {
    const peso = pesoPosicao(r.position);
    pesoTotal += peso;
    if (r.is_own_listing) {
      pesoProprio += peso;
      proprios++;
      if (r.own_store_name) lojas.add(r.own_store_name);
    }
  }

  return {
    categoriaId: categoryId ?? null,
    categoriaNome,
    totalResultados: rows.length,
    resultadosProprios: proprios,
    shareSimples: proprios / rows.length,
    sharePonderado: pesoTotal > 0 ? pesoProprio / pesoTotal : 0,
    lojasContribuintes: [...lojas],
  };
}
