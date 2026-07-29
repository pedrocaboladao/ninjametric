import axios from "axios";
import { getValidAccessToken } from "./tokenStore";

const ML_API_BASE = "https://api.mercadolibre.com";

export interface MlAttribute {
  id: string;
  name?: string;
  value_id?: string | null;
  value_name?: string | null;
}

export interface MlVariation {
  id: number;
  price: number;
  available_quantity: number;
  sold_quantity?: number;
  attribute_combinations: MlAttribute[];
  picture_ids?: string[];
}

export interface MlPicture {
  id: string;
  url: string;
  secure_url: string;
}

export interface MlItemFull {
  id: string;
  title: string;
  category_id: string;
  price: number;
  currency_id: string;
  available_quantity: number;
  condition: string;
  listing_type_id: string;
  buying_mode: string;
  pictures: MlPicture[];
  attributes: MlAttribute[];
  variations: MlVariation[];
  shipping: {
    mode: string;
    local_pick_up: boolean;
    free_shipping: boolean;
    tags?: string[];
  };
  site_id: string;
  permalink: string;
}

async function resolveRedirect(url: string): Promise<string> {
  try {
    const { request } = await axios.get(url, { maxRedirects: 5 });
    return request?.res?.responseUrl ?? url;
  } catch {
    return url;
  }
}

export async function extrairItemIdDaUrl(url: string): Promise<string> {
  const direto = url.match(/MLB-?(\d+)/i);
  if (direto) return `MLB${direto[1]}`;

  const final = await resolveRedirect(url);
  const match = final.match(/MLB-?(\d+)/i);
  if (!match) {
    throw new Error("Não foi possível identificar o código do anúncio (MLB) nessa URL.");
  }
  return `MLB${match[1]}`;
}

// A API do Mercado Livre só deixa ler os detalhes completos de um anúncio (/items/{id})
// com o token da PRÓPRIA conta dona do anúncio — sem token dá PolicyAgent 403, e com o
// token de outra conta (mesmo sendo outra das nossas 4 lojas) dá access_denied 403.
// Por isso o clone só funciona para anúncios que pertencem a uma das 4 lojas cadastradas.

export async function getItemFullComToken(lojaId: number, itemId: string): Promise<MlItemFull> {
  const accessToken = await getValidAccessToken(lojaId);
  const { data } = await axios.get<MlItemFull>(`${ML_API_BASE}/items/${itemId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function getItemDescriptionComToken(lojaId: number, itemId: string): Promise<string> {
  try {
    const accessToken = await getValidAccessToken(lojaId);
    const { data } = await axios.get<{ plain_text: string }>(`${ML_API_BASE}/items/${itemId}/description`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return data.plain_text ?? "";
  } catch {
    return "";
  }
}

// Categoria é informação pública, não precisa de token.
export async function getCategoryName(categoryId: string): Promise<string> {
  try {
    const { data } = await axios.get<{ name: string }>(`${ML_API_BASE}/categories/${categoryId}`);
    return data.name;
  } catch {
    return categoryId;
  }
}

export interface NovoItemPayload {
  title: string;
  category_id: string;
  price: number;
  currency_id: string;
  available_quantity: number;
  buying_mode: string;
  condition: string;
  listing_type_id: string;
  pictures: Array<{ source: string }>;
  attributes: MlAttribute[];
  variations?: Array<{
    attribute_combinations: MlAttribute[];
    price: number;
    available_quantity: number;
  }>;
  shipping: {
    mode: string;
    local_pick_up: boolean;
    free_shipping: boolean;
  };
}

export async function createItem(lojaId: number, payload: NovoItemPayload): Promise<MlItemFull> {
  const accessToken = await getValidAccessToken(lojaId);
  const { data } = await axios.post<MlItemFull>(`${ML_API_BASE}/items`, payload, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function setItemDescription(lojaId: number, itemId: string, plainText: string): Promise<void> {
  if (!plainText.trim()) return;
  const accessToken = await getValidAccessToken(lojaId);
  await axios.post(
    `${ML_API_BASE}/items/${itemId}/description`,
    { plain_text: plainText },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
}

export async function ativarEnviosFlex(lojaId: number, siteId: string, itemId: string): Promise<void> {
  const accessToken = await getValidAccessToken(lojaId);
  await axios.post(
    `${ML_API_BASE}/sites/${siteId}/shipping/selfservice/items/${itemId}`,
    {},
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
}

export async function atualizarFotosDasVariacoes(
  lojaId: number,
  itemId: string,
  variacoes: Array<{ id: number; picture_ids: string[] }>
): Promise<void> {
  const accessToken = await getValidAccessToken(lojaId);
  await axios.put(
    `${ML_API_BASE}/items/${itemId}`,
    { variations: variacoes },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
}
