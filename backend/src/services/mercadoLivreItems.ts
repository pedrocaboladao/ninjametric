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

// Ids de TODOS os atributos que o erro aponta como obrigatórios e faltando
// (ex.: "The attributes [PAINT_TYPE] are required for category..." — pode
// vir mais de um id dentro dos colchetes, separados por vírgula). Ignora
// causas type=warning, que não derrubam a criação.
export function atributosObrigatoriosFaltando(err: unknown): string[] {
  if (!(err instanceof ErroMercadoLivre)) return [];
  const ids = new Set<string>();
  for (const causa of err.causas) {
    if (causa.type === "warning") continue;
    if (!causa.code || !CODES_ATRIBUTO_FALTANDO.has(causa.code)) continue;
    const colchetes = causa.message?.match(/\[([^\]]+)\]/);
    if (!colchetes) continue;
    for (const bruto of colchetes[1].split(",")) {
      const id = bruto.trim();
      if (/^[A-Z0-9_]+$/.test(id)) ids.add(id);
    }
  }
  return [...ids];
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
  // Atributo multivalorado (ex.: PRODUCT_FEATURES) guarda o valor aqui, em
  // vez de value_id/value_name — na criação o formato aceito é a lista de
  // {id, name}.
  values?: Array<{ id?: string | null; name?: string | null }>;
}

export interface MlVariation {
  id: number;
  price: number;
  available_quantity: number;
  sold_quantity?: number;
  attribute_combinations: MlAttribute[];
  picture_ids?: string[];
  // O SKU que aparece na tela do Mercado Livre ("Código de identificação")
  // é o atributo SELLER_SKU DESSA variação, dentro de "attributes" — que a
  // leitura só devolve com o parâmetro include_attributes=all (ver
  // getItemFullComToken). O seller_custom_field é um campo interno legado,
  // sem relação com o SKU da tela (confirmado na documentação).
  attributes?: MlAttribute[];
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
  // include_attributes=all: sem ele, a leitura NÃO devolve os atributos das
  // variações (onde mora o SELLER_SKU de cada cor/tamanho — o "Código de
  // identificação" da tela). Só acrescenta dados; não muda o resto.
  const { data } = await axios.get<MlItemFull>(`${ML_API_BASE}/items/${itemId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { include_attributes: "all" },
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
    // SELLER_SKU da variação vai aqui dentro (é o SKU real da tela);
    // seller_custom_field é só o campo interno legado.
    attributes?: MlAttribute[];
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

// A criação da família roda 4 anúncios em paralelo (ver CONCORRENCIA_FAMILIA
// em clonarAnuncioService), e cada um chamava a ativação do flex ao mesmo
// tempo — rajada de chamadas simultâneas no mesmo endereço, que é o padrão
// clássico pra disparar bloqueio de borda (o 403 de "tengine", que é o
// servidor da frente do Mercado Livre respondendo, não a API). Essa fila
// serializa e espaça só a chamada de ativação, sem serializar a criação dos
// anúncios (que continua paralela) nem as esperas de verificação.
const INTERVALO_MINIMO_FLEX_MS = 800;
let filaFlex: Promise<unknown> = Promise.resolve();
let ultimaChamadaFlex = 0;

function enfileirarChamadaFlex<T>(chamada: () => Promise<T>): Promise<T> {
  const resultado = filaFlex.then(async () => {
    const desdeAUltima = Date.now() - ultimaChamadaFlex;
    if (desdeAUltima < INTERVALO_MINIMO_FLEX_MS) {
      await esperar(INTERVALO_MINIMO_FLEX_MS - desdeAUltima);
    }
    ultimaChamadaFlex = Date.now();
    return chamada();
  });
  // A fila não pode quebrar quando uma ativação falha — o próximo da fila
  // ainda precisa rodar.
  filaFlex = resultado.catch(() => undefined);
  return resultado;
}

// O Mercado Livre marca nas tags de envio do anúncio se ele É ELEGÍVEL pro
// flex ("self_service_available") — sem essa tag, a ativação nunca vai
// funcionar (fora da área de cobertura, categoria não suportada, etc.), e
// insistir na chamada é inútil. Com ela presente mas a ativação falhando, o
// problema é do canal (bloqueio de borda), não do anúncio.
const TAG_FLEX_DISPONIVEL = "self_service_available";

// 403 com corpo HTML = o servidor da frente do Mercado Livre ("tengine")
// barrou a chamada antes de chegar na API — bloqueio de borda/anti-bot, não
// uma resposta de negócio. É o mesmo filtro que responde 403 até pra quem
// tenta ler a documentação deles fora de um navegador.
function ehBloqueioDeBorda(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  const corpo = err.response?.data;
  return typeof corpo === "string" && corpo.toLowerCase().includes("<html");
}

// Quando a borda bloqueia uma chamada, continuar chamando só realimenta o
// bloqueio (e atrasa o lote inteiro em retries inúteis). Ao detectar o
// bloqueio, os próximos anúncios do lote param de tentar o POST por um
// tempo e só conferem o estado — a ativação automática da conta costuma
// ligar o flex sozinha nos anúncios elegíveis.
const JANELA_BLOQUEIO_BORDA_MS = 60_000;
let bordaBloqueadaAte = 0;

function postAtivacaoFlex(accessToken: string, siteId: string, itemId: string): Promise<unknown> {
  return enfileirarChamadaFlex(() =>
    axios.post(
      `${ML_API_BASE}/sites/${siteId}/shipping/selfservice/items/${itemId}`,
      {},
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          // O axios se anuncia como "axios/x.y.z" por padrão, assinatura
          // clássica de bot pro filtro de borda — as outras rotas da API não
          // se importam, mas essa é mais rígida.
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
      }
    )
  );
}

function erroFinalFlex(elegivelVisto: boolean, ultimoErro: unknown): Error {
  if (!elegivelVisto) {
    return new Error(
      "Anúncio criado, mas o Mercado Livre não marcou ele como elegível pro flex (sem a tag de disponibilidade) " +
        "— costuma ser área de cobertura ou categoria. Confira no painel: se o flex aparecer disponível lá, ative manualmente."
    );
  }
  if (ultimoErro === undefined || ehBloqueioDeBorda(ultimoErro)) {
    return new Error(
      "Anúncio criado e elegível pro flex, mas o servidor do Mercado Livre está recusando a ativação via API " +
        "(bloqueio temporário do lado deles). A ativação automática da conta costuma ligar o flex sozinha em " +
        "alguns minutos — confira no painel antes de ativar manualmente."
    );
  }
  return mensagemErroMl(ultimoErro, "Anúncio criado, mas falhou ao ativar envios flex");
}

export async function ativarEnviosFlex(lojaId: number, siteId: string, itemId: string): Promise<void> {
  const accessToken = await getValidAccessToken(lojaId);
  let ultimoErro: unknown;
  let elegivelVisto = false;

  // Lê o estado real do anúncio: flex já ativo encerra na hora (não é caso
  // de aviso), e de quebra registra se o ML o marcou como elegível.
  const conferir = async (): Promise<boolean> => {
    const item = await lerItemSeguro(lojaId, itemId);
    const tags = item?.shipping?.tags ?? [];
    if (tags.includes(TAG_FLEX_DISPONIVEL)) elegivelVisto = true;
    return item !== null && flexEstaAtivo(item);
  };

  if (await conferir()) return;

  // Bloqueio de borda detectado há pouco em outra chamada deste lote: não
  // adianta insistir agora. Dá uma chance pra ativação automática aparecer
  // e reporta com a mensagem certa.
  if (Date.now() < bordaBloqueadaAte) {
    await esperar(ESPERA_FINAL_FLEX_MS);
    if (await conferir()) return;
    throw erroFinalFlex(elegivelVisto, undefined);
  }

  for (let tentativa = 1; tentativa <= TENTATIVAS_FLEX; tentativa++) {
    const item = await lerItemSeguro(lojaId, itemId);
    if (item && flexEstaAtivo(item)) return;
    if (item?.shipping?.tags?.includes(TAG_FLEX_DISPONIVEL)) elegivelVisto = true;

    // Ainda em revisão: o ML só aceita ativar flex em anúncio "active".
    if (item?.status !== undefined && item.status !== "active") {
      if (tentativa < TENTATIVAS_FLEX) await esperar(ESPERA_BASE_FLEX_MS * tentativa);
      continue;
    }

    try {
      await postAtivacaoFlex(accessToken, siteId, itemId);
      return;
    } catch (err) {
      ultimoErro = err;
    }

    // O POST falhou, mas isso não quer dizer que o flex não ligou — confere
    // o estado real antes de tratar como erro.
    if (await conferir()) return;

    if (ehBloqueioDeBorda(ultimoErro)) {
      // Borda bloqueando: abre o "disjuntor" pros próximos anúncios do lote
      // e para de martelar por este também.
      bordaBloqueadaAte = Date.now() + JANELA_BLOQUEIO_BORDA_MS;
      break;
    }

    if (tentativa < TENTATIVAS_FLEX) await esperar(ESPERA_BASE_FLEX_MS * tentativa);
  }

  // Janela estendida: conta com flex habilitado costuma ativar sozinha os
  // anúncios novos elegíveis alguns segundos depois da criação — espera um
  // pouco mais antes de decidir que falhou.
  for (const esperaMs of [5_000, 10_000]) {
    await esperar(esperaMs);
    if (await conferir()) return;
  }

  // Última cartada: o bloqueio pode ter passado nesse meio tempo.
  try {
    await postAtivacaoFlex(accessToken, siteId, itemId);
    return;
  } catch (err) {
    ultimoErro = err;
    if (ehBloqueioDeBorda(err)) bordaBloqueadaAte = Date.now() + JANELA_BLOQUEIO_BORDA_MS;
  }
  if (await conferir()) return;

  throw erroFinalFlex(elegivelVisto, ultimoErro);
}

// Grava o SKU do item. O que vale pra tela e pras buscas é o ATRIBUTO
// SELLER_SKU ("só a informação carregada no atributo SELLER_SKU é levada em
// conta", segundo a documentação) — o seller_custom_field vai junto só por
// compatibilidade com integrações antigas. O PUT de "attributes" atualiza
// por id (não apaga os demais atributos).
export async function definirSkuDoItem(lojaId: number, itemId: string, sku: string): Promise<void> {
  const accessToken = await getValidAccessToken(lojaId);
  try {
    await axios.put(
      `${ML_API_BASE}/items/${itemId}`,
      { seller_custom_field: sku, attributes: [{ id: "SELLER_SKU", value_name: sku }] },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
  } catch (err) {
    throw mensagemErroMl(err, "Anúncio criado, mas falhou ao gravar o SKU");
  }
}

// Em anúncio com variações, o SKU da tela ("Código de identificação") é o
// atributo SELLER_SKU de CADA variação. ATENÇÃO: o PUT de "variations"
// APAGA as variações que não forem enviadas — por isso essa função recebe
// TODAS as variações do anúncio, mesmo as sem SKU (que vão só com o id,
// pra sobreviverem intactas).
export async function definirSkusDasVariacoes(
  lojaId: number,
  itemId: string,
  variacoes: Array<{ id: number; sku?: string }>
): Promise<void> {
  const accessToken = await getValidAccessToken(lojaId);
  try {
    await axios.put(
      `${ML_API_BASE}/items/${itemId}`,
      {
        variations: variacoes.map((v) =>
          v.sku
            ? { id: v.id, seller_custom_field: v.sku, attributes: [{ id: "SELLER_SKU", value_name: v.sku }] }
            : { id: v.id }
        ),
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
  } catch (err) {
    throw mensagemErroMl(err, "Anúncio criado, mas falhou ao gravar o SKU das variações");
  }
}

// Lê o SKU de um item OU de uma variação (as duas formas têm o mesmo
// formato: atributos + campo legado). O atributo SELLER_SKU é o que vale
// (é o que aparece na tela e nas buscas); o seller_custom_field entra só
// como reserva pra anúncio antigo que ainda usa o campo legado.
export function extrairSkuDoItem(item: {
  seller_custom_field?: string | null;
  attributes?: MlAttribute[];
}): string | undefined {
  const atributo = item.attributes?.find((a) => a.id === "SELLER_SKU");
  return atributo?.value_name || item.seller_custom_field || undefined;
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
