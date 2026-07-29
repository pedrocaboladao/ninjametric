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
