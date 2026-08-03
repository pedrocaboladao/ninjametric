import axios from "axios";
import { getValidAccessToken } from "./tokenStore";

const ML_API_BASE = "https://api.mercadolibre.com";

export interface MlOrderItem {
  item: {
    id: string;
    title: string;
    seller_sku?: string;
  };
  quantity: number;
  unit_price: number;
  // Comissão do Mercado Livre — valor por unidade (confirmado empiricamente:
  // dois pedidos do mesmo produto/preço com quantidades diferentes vieram
  // com o mesmo sale_fee, ou seja, não é o total da linha já multiplicado).
  sale_fee?: number;
}

export interface MlOrder {
  id: number;
  date_created: string;
  status: string;
  total_amount: number;
  buyer?: { nickname?: string };
  order_items: MlOrderItem[];
  shipping?: { id: number };
}

interface MlOrderSearchResponse {
  results: MlOrder[];
  paging: { total: number; offset: number; limit: number };
}

export async function searchOrders(
  lojaId: number,
  sellerMlUserId: number,
  fromIso: string,
  toIso: string
): Promise<MlOrder[]> {
  const accessToken = await getValidAccessToken(lojaId);
  const orders: MlOrder[] = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const { data } = await axios.get<MlOrderSearchResponse>(`${ML_API_BASE}/orders/search`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        seller: sellerMlUserId,
        "order.date_created.from": fromIso,
        "order.date_created.to": toIso,
        sort: "date_desc",
        offset,
        limit,
      },
    });

    orders.push(...data.results);

    offset += limit;
    if (offset >= data.paging.total || data.results.length === 0) {
      break;
    }
  }

  return orders;
}

export type PromocaoStatus = "com_promocao" | "sem_promocao" | "anuncio_pausado" | "nao_verificado";

interface MlPromotionEntry {
  status: string;
}

// Consulta a Central de Promoções do ML para um anúncio. Requer a permissão
// de "Preços e promoções" habilitada no app e a conta reautorizada depois
// disso (mudar permissão não atualiza tokens já emitidos) — sem isso, a API
// responde 403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES, e nesse caso tratamos
// como "não verificado" em vez de quebrar o restante do painel. Anúncios
// pausados/encerrados respondem 400 "Item status is not allowed (closed)" —
// distinguimos esse caso porque não é um problema de permissão nem falta de
// promoção, é só um anúncio que não está mais ativo pra ter promoção.
export async function getPromocaoStatus(lojaId: number, itemId: string): Promise<PromocaoStatus> {
  try {
    const accessToken = await getValidAccessToken(lojaId);
    const { data } = await axios.get<MlPromotionEntry[]>(
      `${ML_API_BASE}/seller-promotions/items/${itemId}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, params: { app_version: "v2" } }
    );
    const emPromocao = data.some((p) => p.status === "started");
    return emPromocao ? "com_promocao" : "sem_promocao";
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 400) {
      const mensagem = (err.response.data as { message?: string })?.message ?? "";
      if (mensagem.toLowerCase().includes("closed")) {
        return "anuncio_pausado";
      }
    }
    return "nao_verificado";
  }
}

export type AdsStatus = "ads_ativo" | "sem_ads" | "nao_verificado";

// Consulta o Product Ads (publicidade paga) do Mercado Livre pra um anúncio.
// O item pode nunca ter sido incluído numa campanha (404) ou estar incluído
// mas não rodando no momento ("idle"/"paused") — nos dois casos tratamos
// como "sem_ads", só "active" conta como anúncio realmente em publicidade.
export async function getAdsStatus(lojaId: number, itemId: string): Promise<AdsStatus> {
  try {
    const accessToken = await getValidAccessToken(lojaId);
    const { data } = await axios.get<{ status: string }>(
      `${ML_API_BASE}/advertising/MLB/product_ads/ads/${itemId}`,
      { headers: { Authorization: `Bearer ${accessToken}`, "api-version": "2" } }
    );
    return data.status === "active" ? "ads_ativo" : "sem_ads";
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      return "sem_ads";
    }
    return "nao_verificado";
  }
}

export interface CustoFreteEnvio {
  // Quanto a loja efetivamente paga pelo envio — vem de
  // /shipments/{id}/costs (senders[].cost), não do shipping_option.list_cost
  // do /shipments/{id}. Confirmado com um pedido real e o "Detalhe do
  // recebimento" do próprio Mercado Livre: o list_cost é o preço "cheio" do
  // frete, mas o ML aplica um desconto obrigatório (visto: 50%, tipo
  // "mandatory") antes de debitar do vendedor — usar list_cost inflava o
  // frete vendedor bem acima do valor real cobrado.
  vendedor: number | null;
  // Quanto o comprador paga — /shipments/{id}/costs (receiver.cost). Nos
  // nossos anúncios costuma ser 0 (frete grátis), mas é informação real do
  // pedido, não uma suposição.
  comprador: number | null;
  // Quantos itens (de um ou mais pedidos) foram despachados juntos nesse
  // mesmo envio — confirmado com um pedido real que o custo do envio é do
  // ENVIO inteiro, não do pedido: quando dois pedidos diferentes (cores
  // diferentes do mesmo produto) vão juntos, o mesmo envio aparece pros
  // dois com o custo cheio. Sem dividir por isso, um pedido acaba "levando"
  // o frete que na real é compartilhado com outro.
  itensNoEnvio: number;
}

// Uma vez criado, o envio não muda de custo — cacheia por processo (sem
// TTL) pra não refazer a mesma chamada toda vez que o usuário troca o
// filtro de loja/data no Financeiro (o mesmo pedido aparece em janelas
// diferentes).
const cacheFreteEnvio = new Map<number, CustoFreteEnvio>();

interface MlShipmentCosts {
  receiver?: { cost?: number };
  senders?: { cost?: number }[];
}

export async function getCustoFreteDoEnvio(lojaId: number, shippingId: number): Promise<CustoFreteEnvio> {
  const emCache = cacheFreteEnvio.get(shippingId);
  if (emCache !== undefined) return emCache;

  try {
    const accessToken = await getValidAccessToken(lojaId);
    const headers = { Authorization: `Bearer ${accessToken}` };
    const [{ data: shipment }, { data: costs }] = await Promise.all([
      axios.get<{ shipping_items?: unknown[] }>(`${ML_API_BASE}/shipments/${shippingId}`, { headers }),
      axios.get<MlShipmentCosts>(`${ML_API_BASE}/shipments/${shippingId}/costs`, { headers }),
    ]);
    const resultado: CustoFreteEnvio = {
      vendedor: costs.senders?.reduce((soma, s) => soma + (s.cost ?? 0), 0) ?? null,
      comprador: costs.receiver?.cost ?? null,
      itensNoEnvio: Math.max(1, shipment.shipping_items?.length ?? 1),
    };
    cacheFreteEnvio.set(shippingId, resultado);
    return resultado;
  } catch {
    return { vendedor: null, comprador: null, itensNoEnvio: 1 };
  }
}

export interface MlItemBasicInfo {
  id: string;
  title: string;
  price: number;
  thumbnail: string;
  permalink: string;
}

export async function getItemsBasicInfo(lojaId: number, itemIds: string[]): Promise<Map<string, MlItemBasicInfo>> {
  const result = new Map<string, MlItemBasicInfo>();
  if (itemIds.length === 0) return result;

  const accessToken = await getValidAccessToken(lojaId);
  const uniqueIds = Array.from(new Set(itemIds));

  for (let i = 0; i < uniqueIds.length; i += 20) {
    const batch = uniqueIds.slice(i, i + 20);
    const { data } = await axios.get<Array<{ code: number; body: MlItemBasicInfo }>>(`${ML_API_BASE}/items`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { ids: batch.join(",") },
    });
    for (const entry of data) {
      if (entry.code === 200) {
        result.set(entry.body.id, entry.body);
      }
    }
  }

  return result;
}

export interface MlCampanhaAds {
  id: number;
  name: string;
  status: string;
  budget: number;
  acos_target: number;
  metrics: {
    clicks: number;
    prints: number;
    cost: number;
    cpc: number;
    direct_amount: number;
    indirect_amount: number;
    total_amount: number;
    direct_items_quantity: number;
    indirect_items_quantity: number;
    acos: number;
  };
}

// Cada loja tem uma conta de anunciante própria dentro do Product Ads —
// precisa desse id antes de listar as campanhas. Uma loja pode nunca ter
// aberto o Product Ads (404) — nesse caso não tem o que gerir, retorna null.
export async function getAdvertiserId(lojaId: number): Promise<number | null> {
  try {
    const accessToken = await getValidAccessToken(lojaId);
    const { data } = await axios.get<{ advertisers: { advertiser_id: number }[] }>(
      `${ML_API_BASE}/advertising/advertisers`,
      { headers: { Authorization: `Bearer ${accessToken}` }, params: { product_id: "PADS" } }
    );
    return data.advertisers?.[0]?.advertiser_id ?? null;
  } catch {
    return null;
  }
}

// O endpoint de busca de campanhas fica sob /marketplace (não é o mesmo
// prefixo /advertising usado pro status simples de anúncio) e exige
// date_from/date_to — confirmado por tentativa e erro, a documentação
// pública lista o caminho sem o /marketplace, mas só esse funciona de
// verdade.
export async function getCampanhasAds(
  lojaId: number,
  advertiserId: number,
  dateFrom: string,
  dateTo: string
): Promise<MlCampanhaAds[]> {
  const accessToken = await getValidAccessToken(lojaId);
  const headers = { Authorization: `Bearer ${accessToken}`, "api-version": "2" };
  const metrics =
    "clicks,prints,cost,cpc,acos,direct_items_quantity,indirect_items_quantity,direct_amount,indirect_amount,total_amount";

  const campanhas: MlCampanhaAds[] = [];
  let offset = 0;
  const limit = 50;
  while (true) {
    const { data } = await axios.get<{ paging: { total: number }; results: MlCampanhaAds[] }>(
      `${ML_API_BASE}/marketplace/advertising/MLB/advertisers/${advertiserId}/product_ads/campaigns/search`,
      { headers, params: { limit, offset, date_from: dateFrom, date_to: dateTo, metrics } }
    );
    campanhas.push(...data.results);
    offset += limit;
    if (offset >= data.paging.total || data.results.length === 0) break;
  }
  return campanhas;
}
