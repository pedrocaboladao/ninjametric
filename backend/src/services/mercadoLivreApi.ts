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
}

export interface MlOrder {
  id: number;
  date_created: string;
  status: string;
  total_amount: number;
  buyer?: { nickname?: string };
  order_items: MlOrderItem[];
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
