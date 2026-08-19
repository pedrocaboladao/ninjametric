import { env } from "../config/env";
import type { MarketProvider, ProductResult } from "./MarketProvider";

const ENDPOINT = "https://api.geckoapi.com.br/v1/extract";

// IMPORTANTE — contrato ainda não confirmado contra a documentação real da
// GeckoAPI (fica atrás de login em dashboard.geckoapi.com.br). O formato
// abaixo (endpoint, header Bearer, "target"/"type") é o que aparece nos
// exemplos públicos do blog deles para páginas de produto (type: "pdp") —
// para busca, estou assumindo type: "search" + "query" por analogia. Ajustar
// `montarRequisicao` e `normalizarResposta` assim que houver uma conta real
// pra testar uma chamada de verdade.
function montarRequisicao(keyword: string) {
  return {
    url: ENDPOINT,
    body: {
      target: "mercadolivre.com.br",
      type: "search",
      query: keyword,
    },
  };
}

// Isolado numa função só pra ser fácil de ajustar sem mexer no resto do
// provider quando confirmarmos o formato real da resposta.
function normalizarResposta(json: unknown): ProductResult[] {
  const resultados = extrairListaResultados(json);

  return resultados.map((item, indice) => ({
    position: numeroOuNulo(item.position ?? item.rank) ?? indice + 1,
    itemId: String(item.item_id ?? item.itemId ?? item.id ?? ""),
    title: textoOuNulo(item.title ?? item.name),
    sellerId: textoOuNulo(item.seller_id ?? item.seller?.id),
    sellerName: textoOuNulo(item.seller_name ?? item.seller?.name),
    price: numeroOuNulo(item.price),
    originalPrice: numeroOuNulo(item.original_price ?? item.originalPrice),
    rating: numeroOuNulo(item.rating),
    reviewCount: numeroOuNulo(item.review_count ?? item.reviewCount),
    soldQuantity: textoOuNulo(item.sold_quantity ?? item.soldQuantity),
    shippingType: textoOuNulo(item.shipping_type ?? item.shipping?.type ?? item.shipping),
    isFull: booleanoOuNulo(item.full ?? item.is_full),
    officialStore: booleanoOuNulo(item.official_store ?? item.officialStore),
    isCatalog: booleanoOuNulo(item.catalog ?? item.is_catalog),
    sponsored: booleanoOuNulo(item.sponsored),
    brand: textoOuNulo(item.brand),
    url: textoOuNulo(item.url ?? item.source_url),
  }));
}

// A resposta pode vir em "data", "results" ou "items" dependendo do
// endpoint/versão — tenta as variações conhecidas antes de desistir.
function extrairListaResultados(json: unknown): Record<string, any>[] {
  if (!json || typeof json !== "object") {
    throw new Error("GeckoAPI: resposta em formato inesperado (não é objeto).");
  }
  const obj = json as Record<string, any>;
  const candidatos = [obj.data, obj.results, obj.items];
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
    return normalizarResposta(json);
  }
}
