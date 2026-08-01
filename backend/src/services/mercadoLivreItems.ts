import axios from "axios";
import { getValidAccessToken } from "./tokenStore";

const ML_API_BASE = "https://api.mercadolibre.com";

interface MlErrorCause {
  cause_id?: number;
  code?: string;
  message?: string;
}

// Erro estruturado do Mercado Livre — guarda as "causas" originais (cause_id,
// code) além da mensagem, pra quem chamar poder decidir automaticamente uma
// ação diferente (ex.: cause_id 374 = categoria exige o modelo User Product
// em vez do array `variations` clássico) sem precisar reinterpretar texto.
export class ErroMercadoLivre extends Error {
  causas: MlErrorCause[];
  constructor(mensagem: string, causas: MlErrorCause[] = []) {
    super(mensagem);
    this.name = "ErroMercadoLivre";
    this.causas = causas;
  }
}

// Por padrão, o axios só dá "Request failed with status code 400" — sem o
// motivo de verdade que o Mercado Livre manda no corpo da resposta (ex.:
// atributo obrigatório faltando, categoria não aceita o tipo de anúncio,
// etc.). Essa função extrai esse detalhe pra virar uma mensagem útil.
function mensagemErroMl(err: unknown, contexto: string): Error {
  if (axios.isAxiosError(err)) {
    const corpo = err.response?.data as { cause?: MlErrorCause[] } | undefined;
    if (corpo) {
      return new ErroMercadoLivre(`${contexto}: ${JSON.stringify(corpo)}`, corpo.cause ?? []);
    }
  }
  return new Error(`${contexto}: ${err instanceof Error ? err.message : "erro desconhecido"}`);
}

// Categoria migrada pro modelo User Product: a API recusa o array
// `variations` clássico e exige que cada variação vire um item/anúncio
// independente, ligado aos demais pelo mesmo `family_name`. Já vimos dois
// cause_id diferentes reportarem essa mesma causa raiz: 369 (sem family_name
// no corpo) e 374 (variations inválido junto com family_name) — por isso
// também checa a mensagem, caso apareça outro cause_id novo no futuro.
const CAUSE_IDS_USER_PRODUCT = new Set([369, 374]);

export function requerModeloUserProduct(err: unknown): boolean {
  if (!(err instanceof ErroMercadoLivre)) return false;
  return err.causas.some(
    (c) =>
      (c.cause_id !== undefined && CAUSE_IDS_USER_PRODUCT.has(c.cause_id)) ||
      c.message?.toLowerCase().includes("family_name") ||
      c.message?.toLowerCase().includes("family name")
  );
}

// Algumas categorias recusam reaproveitar o GTIN do anúncio original (código
// já usado em outra categoria/anúncio) — mas outras categorias EXIGEM o
// GTIN, então não dá pra simplesmente nunca enviar. A estratégia é: tentar
// com o GTIN normal e, só se vier esse erro específico, tentar de novo sem
// o atributo.
export function requerRemoverGtin(err: unknown): boolean {
  if (!(err instanceof ErroMercadoLivre)) return false;
  return err.causas.some((c) => c.code === "item.attribute.invalid_product_identifier");
}

// Anúncios antigos podem não ter atributos que categorias exigem hoje em dia
// (ex.: declaração de inflamabilidade, cubagem, GTIN). O Mercado Livre usa
// mais de um código pra essa mesma ideia — "missing_required" (obrigatório
// direto) e "missing_conditional_required" (obrigatório dependendo de outra
// coisa, ex.: GTIN só é obrigatório se não tiver Marca+Modelo) — por isso
// aceita os dois.
const CODES_ATRIBUTO_FALTANDO = new Set(["item.attributes.missing_required", "item.attribute.missing_conditional_required"]);

export function atributoObrigatorioFaltando(err: unknown, attributeId: string): boolean {
  if (!(err instanceof ErroMercadoLivre)) return false;
  return err.causas.some((c) => c.code && CODES_ATRIBUTO_FALTANDO.has(c.code) && c.message?.includes(`[${attributeId}]`));
}

// Erro citando o atributo mas com um code diferente de "está faltando" —
// ou seja, a categoria de destino não aceita esse atributo (ex.: cubagem
// que enviamos por padrão, mas essa categoria específica rejeita).
export function atributoRejeitado(err: unknown, attributeId: string): boolean {
  if (!(err instanceof ErroMercadoLivre)) return false;
  return err.causas.some(
    (c) => c.message?.includes(`[${attributeId}]`) && !(c.code && CODES_ATRIBUTO_FALTANDO.has(c.code))
  );
}

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
  family_name?: string;
  // Presentes quando o anúncio já é do modelo User Product — cada "cor" é um
  // item/anúncio separado, todos com o mesmo family_id.
  family_id?: number;
  user_product_id?: string;
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

export type IdentificadorAnuncio = { tipo: "item"; id: string } | { tipo: "user_product"; id: string };

// Extrai só da parte "de caminho" da URL (antes de ?/#) — links de recomendação
// do próprio Mercado Livre costumam levar parâmetros de rastreamento
// (ex.: "wid=MLB...") que também batem com o padrão de um MLB e confundiam
// a extração antiga, pegando o item errado.
function extrairDoCaminho(url: string): IdentificadorAnuncio | null {
  const caminho = url.split(/[?#]/)[0];
  const userProduct = caminho.match(/MLBU(\d+)/i);
  if (userProduct) return { tipo: "user_product", id: `MLBU${userProduct[1]}` };

  const item = caminho.match(/MLB-?(\d+)/i);
  if (item) return { tipo: "item", id: `MLB${item[1]}` };

  return null;
}

export async function extrairItemIdDaUrl(url: string): Promise<IdentificadorAnuncio> {
  const direto = extrairDoCaminho(url);
  if (direto) return direto;

  const final = await resolveRedirect(url);
  const resolvido = extrairDoCaminho(final);
  if (!resolvido) {
    throw new Error("Não foi possível identificar o código do anúncio (MLB) nessa URL.");
  }
  return resolvido;
}

// Resolve um user_product_id (link "/up/MLBU...") pro item_id de fato — só
// funciona com o token da conta dona do produto (mesma regra dos itens).
export async function resolverItemIdPorUserProduct(
  lojaId: number,
  mlUserId: number,
  userProductId: string
): Promise<string | null> {
  const accessToken = await getValidAccessToken(lojaId);
  try {
    const { data } = await axios.get<{ results: string[] }>(`${ML_API_BASE}/users/${mlUserId}/items/search`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { user_product_id: userProductId },
    });
    return data.results[0] ?? null;
  } catch {
    return null;
  }
}

// Lista todas as "cores" (user_product_ids) de uma família do modelo User Product.
export async function listarFamiliaUserProducts(
  lojaId: number,
  siteId: string,
  familyId: number
): Promise<string[]> {
  const accessToken = await getValidAccessToken(lojaId);
  const { data } = await axios.get<{ user_products_ids: string[] }>(
    `${ML_API_BASE}/sites/${siteId}/user-products-families/${familyId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return data.user_products_ids;
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
  // No modelo User Product (quando family_name é usado), o título é gerado
  // automaticamente pelo Mercado Livre a partir do family_name + atributos —
  // enviar "title" junto dá erro "The fields [title] are invalid".
  title?: string;
  category_id: string;
  price: number;
  currency_id: string;
  available_quantity: number;
  buying_mode: string;
  condition: string;
  listing_type_id: string;
  pictures: Array<{ source: string }>;
  attributes: MlAttribute[];
  family_name?: string;
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
  try {
    const { data } = await axios.post<MlItemFull>(`${ML_API_BASE}/items`, payload, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return data;
  } catch (err) {
    throw mensagemErroMl(err, "Falha ao criar o anúncio no Mercado Livre");
  }
}

export async function setItemDescription(lojaId: number, itemId: string, plainText: string): Promise<void> {
  if (!plainText.trim()) return;
  const accessToken = await getValidAccessToken(lojaId);
  try {
    await axios.post(
      `${ML_API_BASE}/items/${itemId}/description`,
      { plain_text: plainText },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
  } catch (err) {
    throw mensagemErroMl(err, "Anúncio criado, mas falhou ao salvar a descrição");
  }
}

export async function ativarEnviosFlex(lojaId: number, siteId: string, itemId: string): Promise<void> {
  const accessToken = await getValidAccessToken(lojaId);
  try {
    await axios.post(
      `${ML_API_BASE}/sites/${siteId}/shipping/selfservice/items/${itemId}`,
      {},
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
  } catch (err) {
    throw mensagemErroMl(err, "Anúncio criado, mas falhou ao ativar envios flex");
  }
}

export async function atualizarFotosDasVariacoes(
  lojaId: number,
  itemId: string,
  variacoes: Array<{ id: number; picture_ids: string[] }>
): Promise<void> {
  const accessToken = await getValidAccessToken(lojaId);
  try {
    await axios.put(
      `${ML_API_BASE}/items/${itemId}`,
      { variations: variacoes },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
  } catch (err) {
    throw mensagemErroMl(err, "Anúncio criado, mas falhou ao vincular as fotos das variações");
  }
}
