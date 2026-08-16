import axios from "axios";
import { getValidAccessToken } from "./tokenStore";

const ML_API_BASE = "https://api.mercadolibre.com";

interface MlErrorCause {
  cause_id?: number;
  code?: string;
  message?: string;
  // "error" derruba a criação; "warning" vem junto só como aviso (ex.: um
  // atributo que o Mercado Livre ignorou por não ser editável) e não deve
  // disparar nenhuma correção automática.
  type?: string;
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
    const corpo = err.response?.data as { cause?: MlErrorCause[] } | string | undefined;

    // Corpo em HTML = página de erro do servidor/proxy do Mercado Livre
    // ("tengine"), não a API respondendo. Despejar esse HTML inteiro na tela
    // não ajuda ninguém — vira uma frase que diz o que de fato aconteceu.
    if (typeof corpo === "string" && corpo.toLowerCase().includes("<html")) {
      return new Error(
        `${contexto}: o servidor do Mercado Livre recusou a chamada (HTTP ${err.response?.status ?? "?"}) ` +
          `sem detalhe de API — costuma ser bloqueio temporário do lado deles, não um problema do anúncio.`
      );
    }

    if (corpo && typeof corpo === "object") {
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
// direto), "missing_conditional_required" (obrigatório dependendo de outra
// coisa, ex.: GTIN só é obrigatório se não tiver Marca+Modelo) e
// "business_conditional" (obrigatório por causa de outro campo já
// preenchido, ex.: UNITS_PER_PACK quando "Formato de venda" = Unidade) —
// por isso aceita os três.
const CODES_ATRIBUTO_FALTANDO = new Set([
  "item.attributes.missing_required",
  "item.attribute.missing_conditional_required",
  "create.item.attribute.business_conditional",
]);

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

// A categoria de destino aceita o atributo, mas não aceita o VALOR que
// mandamos (ex.: "Attribute [BASE_TYPE] is not valid, item values
// [(45947933:Manta Liquida)]"). Acontece porque o value_id é da tabela de
// valores da categoria do anúncio original — outra categoria/produto pode
// ter o mesmo valor com outro id, ou não ter esse valor. Devolve os ids
// dos atributos citados, pra quem chamar decidir o que fazer.
const CODE_VALOR_INVALIDO = "invalid.item.attribute.values";

export function atributosComValorInvalido(err: unknown): string[] {
  if (!(err instanceof ErroMercadoLivre)) return [];
  const ids: string[] = [];
  for (const causa of err.causas) {
    if (causa.type === "warning") continue;
    if (causa.code !== CODE_VALOR_INVALIDO) continue;
    const encontrado = causa.message?.match(/Attribute \[([A-Za-z0-9_]+)\]/);
    if (encontrado) ids.push(encontrado[1]);
  }
  return ids;
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
  // SKU específico da variação (ex.: cada tamanho/cor com seu próprio
  // código) — separado do SKU do item pai, que fica em
  // MlItemFull.seller_custom_field.
  seller_custom_field?: string | null;
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
  // SKU do item — código que o resto do sistema usa como referência real de
  // produto (Financeiro/Produtos/Precificação). Separado dos atributos
  // (existe também um atributo SELLER_SKU em algumas categorias, mas esse
  // campo dedicado é o canônico).
  seller_custom_field?: string | null;
  family_name?: string;
  // "active", "under_review", "paused"... — o Mercado Livre só aceita ativar
  // envios flex num anúncio já "active", e recém-criado ele pode levar alguns
  // segundos pra chegar nesse estado (ver ativarEnviosFlex).
  status?: string;
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
  seller_custom_field?: string | null;
  family_name?: string;
  variations?: Array<{
    attribute_combinations: MlAttribute[];
    price: number;
    available_quantity: number;
    seller_custom_field?: string | null;
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

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A própria API do Mercado Livre expõe o estado real do flex nas tags de
// envio do anúncio: "self_service_in" = flex ativo, "self_service_out" =
// desligado. É por aqui que dá pra saber se o flex está ligado de verdade,
// em vez de confiar na resposta do POST de ativação — que já foi visto
// devolvendo 403 do proxy deles (página HTML genérica do "tengine", não o
// JSON de erro normal da API) mesmo em anúncios que acabaram com o flex
// ativo.
const TAG_FLEX_ATIVO = "self_service_in";

export function flexEstaAtivo(item: MlItemFull): boolean {
  return item.shipping?.tags?.includes(TAG_FLEX_ATIVO) ?? false;
}

// O Mercado Livre só aceita ativar flex num anúncio que já esteja "active",
// e um anúncio recém-criado leva alguns segundos pra sair de "under_review"
// — daí as tentativas com espera crescente. Mantido curto de propósito:
// lotes grandes (até 20 cópias em sequência) já competem com o timeout de
// 300s do Nginx.
const TENTATIVAS_FLEX = 4;
const ESPERA_BASE_FLEX_MS = 1500;
// O Mercado Livre processa a ativação de forma assíncrona: já vimos anúncio
// aparecer com o flex ligado só alguns segundos DEPOIS da chamada (inclusive
// depois de responder 403 do proxy). Essa espera extra antes da checagem
// final existe pra não acusar falha num flex que estava só demorando. Só
// pesa nos anúncios que falharam — quem ativou de primeira nem chega aqui.
const ESPERA_FINAL_FLEX_MS = 5000;

async function lerItemSeguro(lojaId: number, itemId: string): Promise<MlItemFull | null> {
  try {
    return await getItemFullComToken(lojaId, itemId);
  } catch {
    return null;
  }
}

export async function ativarEnviosFlex(lojaId: number, siteId: string, itemId: string): Promise<void> {
  const accessToken = await getValidAccessToken(lojaId);
  let ultimoErro: unknown;

  for (let tentativa = 1; tentativa <= TENTATIVAS_FLEX; tentativa++) {
    const item = await lerItemSeguro(lojaId, itemId);

    // Já está ativo (conta com flex ligado costuma criar o anúncio assim) —
    // não precisa chamar nada, e principalmente não é caso de aviso.
    if (item && flexEstaAtivo(item)) return;

    // Ainda em revisão: chamar agora seria rejeitado de qualquer forma.
    if (item?.status !== undefined && item.status !== "active") {
      if (tentativa < TENTATIVAS_FLEX) await esperar(ESPERA_BASE_FLEX_MS * tentativa);
      continue;
    }

    try {
      await axios.post(
        `${ML_API_BASE}/sites/${siteId}/shipping/selfservice/items/${itemId}`,
        {},
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      return;
    } catch (err) {
      ultimoErro = err;
    }

    // O POST falhou, mas isso não quer dizer que o flex não ligou — confere
    // o estado real antes de tratar como erro (esse é exatamente o caso do
    // 403 do proxy em anúncio que acaba com flex ativo).
    const depois = await lerItemSeguro(lojaId, itemId);
    if (depois && flexEstaAtivo(depois)) return;

    if (tentativa < TENTATIVAS_FLEX) await esperar(ESPERA_BASE_FLEX_MS * tentativa);
  }

  // Última checagem antes de desistir, depois de uma espera maior: a
  // ativação pode ter sido processada com atraso do lado do Mercado Livre.
  await esperar(ESPERA_FINAL_FLEX_MS);
  const final = await lerItemSeguro(lojaId, itemId);
  if (final && flexEstaAtivo(final)) return;

  throw mensagemErroMl(ultimoErro, "Anúncio criado, mas falhou ao ativar envios flex");
}

// O POST /items nem sempre persiste o seller_custom_field (o SKU do
// anúncio) — dependendo da categoria/modelo o campo só "cola" num PUT
// depois da criação. Como é esse campo que o resto do sistema usa como SKU
// de verdade (Financeiro/Produtos/Precificação), vale gravar de novo
// explicitamente quando o anúncio criado não veio com ele.
export async function definirSkuDoItem(lojaId: number, itemId: string, sku: string): Promise<void> {
  const accessToken = await getValidAccessToken(lojaId);
  try {
    await axios.put(
      `${ML_API_BASE}/items/${itemId}`,
      { seller_custom_field: sku },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
  } catch (err) {
    throw mensagemErroMl(err, "Anúncio criado, mas falhou ao gravar o SKU");
  }
}

// Em anúncio com variações, o SKU não fica no anúncio: fica em CADA
// variação (é o campo "Código de identificação (SKU)" que aparece junto do
// estoque de cada cor/tamanho no Mercado Livre). Esse valor não cola na
// criação — precisa desse PUT depois, com o id da variação já criada.
export async function definirSkusDasVariacoes(
  lojaId: number,
  itemId: string,
  variacoes: Array<{ id: number; seller_custom_field: string }>
): Promise<void> {
  const accessToken = await getValidAccessToken(lojaId);
  try {
    await axios.put(
      `${ML_API_BASE}/items/${itemId}`,
      { variations: variacoes },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
  } catch (err) {
    throw mensagemErroMl(err, "Anúncio criado, mas falhou ao gravar o SKU das variações");
  }
}

// O SKU pode estar em dois lugares dependendo da categoria: no campo
// dedicado do anúncio (seller_custom_field, o canônico pro resto do
// sistema) ou no atributo SELLER_SKU. Pra clonar, serve qualquer um dos
// dois — o que importa é não perder o código do produto.
export function extrairSkuDoItem(item: {
  seller_custom_field?: string | null;
  attributes?: MlAttribute[];
}): string | undefined {
  if (item.seller_custom_field) return item.seller_custom_field;
  const atributo = item.attributes?.find((a) => a.id === "SELLER_SKU");
  return atributo?.value_name || undefined;
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
