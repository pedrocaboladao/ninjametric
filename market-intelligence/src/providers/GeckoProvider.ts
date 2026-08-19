import { env } from "../config/env";
import type { MarketProvider, ProductResult } from "./MarketProvider";

const ENDPOINT = "https://api.geckoapi.com.br/v1/extract";

// Confirmado com uma chamada real (erro 400 da própria API expôs o
// contrato): pra mercadolivre.com.br só existe type=pdp / type=plp /
// type=review, e é preciso mandar uma "url" de verdade — não um parâmetro
// solto de busca. "plp" (product list page) é a página de resultados de
// busca do Mercado Livre, então construímos a URL de busca do próprio site
// e pedimos pra GeckoAPI extrair aquela página.
function montarRequisicao(keyword: string) {
  const slug = encodeURIComponent(keyword.trim().toLowerCase().replace(/\s+/g, "-"));
  return {
    url: ENDPOINT,
    body: {
      url: `https://lista.mercadolivre.com.br/${slug}`,
      target: "mercadolivre.com.br",
      type: "plp",
    },
  };
}

// Confirmado com uma resposta real de type=plp: os itens ficam em
// "data.items" (não "data" direto), e os nomes de campo são os do próprio
// Mercado Livre (name/sku/aggregateRating), não um formato genérico. Vários
// campos que a GeckoAPI não devolve pra esse tipo de página (frete,
// catálogo, patrocinado, marca, preço original) ficam null de propósito —
// não inventa o que a API não manda.
function normalizarResposta(json: unknown): ProductResult[] {
  const resultados = extrairListaResultados(json);

  return resultados.map((item, indice) => ({
    position: numeroOuNulo(item.position ?? item.rank) ?? indice + 1,
    itemId: String(item.sku ?? item.item_id ?? item.itemId ?? item.id ?? ""),
    title: textoOuNulo(item.name ?? item.title),
    sellerId: textoOuNulo(item.sellerId ?? item.seller_id ?? item.seller?.id),
    sellerName: textoOuNulo(item.sellerName ?? item.seller_name ?? item.seller?.name),
    price: numeroOuNulo(item.price),
    originalPrice: numeroOuNulo(item.originalPrice ?? item.original_price),
    rating: numeroOuNulo(item.aggregateRating?.rating ?? item.rating),
    reviewCount: numeroOuNulo(item.aggregateRating?.reviewCount ?? item.review_count),
    soldQuantity: textoOuNulo(item.soldQuantity ?? item.sold_quantity),
    shippingType: textoOuNulo(item.shippingType ?? item.shipping_type ?? item.shipping?.type),
    isFull: booleanoOuNulo(item.isFull ?? item.full),
    officialStore: booleanoOuNulo(item.officialStore ?? item.official_store),
    isCatalog: booleanoOuNulo(item.isCatalog ?? item.catalog),
    sponsored: booleanoOuNulo(item.sponsored),
    brand: textoOuNulo(item.brand),
    url: textoOuNulo(item.url ?? item.source_url),
    categoryId: textoOuNulo(item.categoryId ?? item.category_id),
    domainId: textoOuNulo(item.domainId ?? item.domain_id),
  }));
}

function extrairListaResultados(json: unknown): Record<string, any>[] {
  if (!json || typeof json !== "object") {
    throw new Error("GeckoAPI: resposta em formato inesperado (não é objeto).");
  }
  const obj = json as Record<string, any>;
  // Formato real confirmado: obj.data.items. Mantém "data"/"results"/"items"
  // soltos como fallback pra outros tipos de resposta (pdp, review) que
  // ainda não testamos.
  const candidatos = [obj.data?.items, obj.data, obj.results, obj.items];
  const lista = candidatos.find((c) => Array.isArray(c));
  if (!lista) {
    throw new Error("GeckoAPI: não encontrei uma lista de resultados na resposta (checar contrato real da API).");
  }
  return lista;
}

function textoOuNulo(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function numeroOuNulo(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && !Number.isNaN(n) ? n : null;
}

function booleanoOuNulo(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

export class GeckoProvider implements MarketProvider {
  readonly name = "gecko";

  async searchProducts(keyword: string): Promise<ProductResult[]> {
    if (!env.geckoApiKey) {
      throw new Error("GECKO_API_KEY não configurada — busca de mercado indisponível.");
    }

    const { url, body } = montarRequisicao(keyword);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.geckoApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const texto = await res.text().catch(() => "");
      throw new Error(`GeckoAPI respondeu ${res.status}: ${texto.slice(0, 300)}`);
    }

    const json = await res.json();
    try {
      return normalizarResposta(json);
    } catch (err) {
      // Contrato de resposta ainda não 100% confirmado — loga uma amostra
      // bruta pra facilitar o ajuste de normalizarResposta() sem precisar
      // de mais uma rodada de tentativa e erro.
      console.error("GeckoAPI: falha ao normalizar resposta. Amostra bruta:", JSON.stringify(json).slice(0, 1500));
      throw err;
    }
  }
}
