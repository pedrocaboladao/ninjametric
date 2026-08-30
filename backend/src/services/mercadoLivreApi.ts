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

export interface MlCampanhaVendedor {
  id: string;
  type: string;
  sub_type: string;
  status: string;
  start_date: string;
  finish_date: string;
  name: string;
}

// Cria uma campanha do vendedor (desconto por %, prazo máximo de 14 dias —
// regra do próprio Mercado Livre, não uma limitação nossa). dataInicio e
// dataFim vêm no formato "YYYY-MM-DD"; a API exige formato local sem fuso
// ("YYYY-MM-DDT00:00:00"), não ISO com "Z".
export async function criarCampanhaVendedor(
  lojaId: number,
  nome: string,
  dataInicio: string,
  dataFim: string
): Promise<MlCampanhaVendedor> {
  const accessToken = await getValidAccessToken(lojaId);
  const { data } = await axios.post<MlCampanhaVendedor>(
    `${ML_API_BASE}/seller-promotions/promotions`,
    {
      promotion_type: "SELLER_CAMPAIGN",
      name: nome,
      sub_type: "FLEXIBLE_PERCENTAGE",
      start_date: `${dataInicio}T00:00:00`,
      finish_date: `${dataFim}T00:00:00`,
    },
    { headers: { Authorization: `Bearer ${accessToken}` }, params: { app_version: "v2" } }
  );
  return data;
}

// Adiciona um item a uma promoção com o preço final já calculado (não manda
// percentual pra API — o Mercado Livre trabalha com preço final em R$ por
// item, ver deal_price). promotionType aceita qualquer tipo devolvido por
// consultarPromocoesDoItem (SELLER_CAMPAIGN, SMART, DEAL — não só campanha
// própria, ver promocoesOportunidadesService).
//
// offerId: só o tipo SMART tem/precisa disso (campo ref_id da resposta de
// consultarPromocoesDoItem) — descoberto ao vivo depois de um 400 real
// "Offer id is required" tentando aprovar sem mandar esse campo. Sem
// confirmação oficial se os outros tipos algum dia vão precisar também,
// então só manda quando vier preenchido.
export async function adicionarItemCampanha(
  lojaId: number,
  itemId: string,
  promotionId: string,
  promotionType: string,
  dealPrice: number,
  offerId?: string | null
): Promise<void> {
  const accessToken = await getValidAccessToken(lojaId);
  await axios.post(
    `${ML_API_BASE}/seller-promotions/items/${itemId}`,
    {
      promotion_id: promotionId,
      promotion_type: promotionType,
      deal_price: dealPrice,
      ...(offerId ? { offer_id: offerId } : {}),
    },
    { headers: { Authorization: `Bearer ${accessToken}` }, params: { app_version: "v2" } }
  );
}

export async function obterDetalhesCampanha(lojaId: number, promotionId: string): Promise<MlCampanhaVendedor> {
  const accessToken = await getValidAccessToken(lojaId);
  const { data } = await axios.get<MlCampanhaVendedor>(
    `${ML_API_BASE}/seller-promotions/promotions/${promotionId}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, params: { promotion_type: "SELLER_CAMPAIGN", app_version: "v2" } }
  );
  return data;
}

export interface MlItemCampanha {
  itemId: string;
  status: string;
  price: number;
  originalPrice: number;
}

// Existiu aqui uma obterItensDaCampanha() que listava os itens de uma
// campanha pelo endpoint /seller-promotions/promotions/{id}/items — removida
// porque a paginação por offset dele é pouco confiável em campanha grande:
// pedir offset diferente devolvia essencialmente os mesmos ~50 itens
// embaralhados, travando a descoberta bem abaixo do total real (achado ao
// vivo: campanha com 229 itens no Mercado Livre, função só via 50). A lista
// de itens de uma campanha agora é montada em
// promocoesService.descobrirCampanhasNaLoja a partir do scan item-a-item
// (consultarPromocoesDoItem, que já roda pra achar a campanha) — mais
// confiável, e sem chamada extra por item.

// Lista o item_id de todos os anúncios ATIVOS de uma loja — usada só pra
// descoberta automática de campanhas já existentes (ver
// promocoesService.descobrirCampanhas): não tem outro jeito de achar
// "quais anúncios estão em promoção" sem checar anúncio por anúncio, já
// que o Mercado Livre não tem endpoint de "listar minhas campanhas".
export async function listarItensAtivos(lojaId: number, mlUserId: number): Promise<string[]> {
  const accessToken = await getValidAccessToken(lojaId);
  const itemIds: string[] = [];
  let scrollId: string | undefined;
  // A busca de itens do ML não pagina por offset além de 1000 resultados —
  // achado real: a Catedral tem mais de 1000 anúncios ativos, e a
  // descoberta automática de promoções batia esse teto e nem chegava a
  // checar o resto (campanha real ficando com bem menos itens do que
  // deveria). search_type=scan + scroll_id é o mecanismo do próprio ML pra
  // ir além de 1000 (documentação oficial: "release the offset", usa o
  // scroll_id devolvido a cada resposta pra pedir a próxima leva). Trava de
  // segurança de 50 páginas (até ~50 mil itens) pra nunca ficar em loop
  // infinito se o scroll_id parar de vir por algum motivo.
  const MAX_PAGINAS = 50;
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const { data } = await axios.get<{ results: string[]; scroll_id?: string }>(
      `${ML_API_BASE}/users/${mlUserId}/items/search`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { status: "active", search_type: "scan", ...(scrollId ? { scroll_id: scrollId } : {}) },
      }
    );
    itemIds.push(...data.results);
    if (data.results.length === 0 || !data.scroll_id) break;
    scrollId = data.scroll_id;
  }
  // search_type=scan NÃO devolve anúncios de catálogo (achado real:
  // comparando o export do Mercado Livre com o nosso, os 16 itens que
  // faltavam tinham TODOS catalog_listing=true, enquanto uma amostra dos
  // que aparecem normalmente tinha TODOS catalog_listing=false — padrão
  // 100% consistente). Busca suplementar sem scan, filtrando só catálogo,
  // pra cobrir esse buraco — paginação por offset de novo aqui é segura
  // porque catálogo costuma ser um subconjunto pequeno da loja inteira,
  // bem longe do teto de 1000 que motivou trocar pro scan em primeiro lugar.
  const itensCatalogo: string[] = [];
  for (let offset = 0; offset < 1000; offset += 50) {
    const { data } = await axios.get<{ results: string[] }>(`${ML_API_BASE}/users/${mlUserId}/items/search`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { status: "active", catalog_listing: "true", offset, limit: 50 },
    });
    itensCatalogo.push(...data.results);
    if (data.results.length < 50) break;
  }

  // Paginação por scroll pode repetir item entre páginas (comportamento
  // conhecido desse tipo de paginação, se o catálogo muda durante a
  // varredura) — sem isso, um item "started" repetido vira contagem dobrada
  // de itens na campanha (achado real: 493 itens encontrados numa campanha
  // que o próprio Mercado Livre mostra ~229).
  return Array.from(new Set([...itemIds, ...itensCatalogo]));
}

const CAP_CANDIDATOS_POR_GAUGE = 150;

// "reputation_health_gauge" (unhealthy/warning) devolve uma lista de
// candidatos a problema de qualidade de anúncio — não é um proxy limpo só
// da Experiência de Compra (mistura anúncio parado, ficha de catálogo
// divergente etc., confirmado ao vivo contra a Catedral: itens "warning"
// que na verdade tinham nota "Boa"). Serve só pra reduzir a lista antes de
// checar o detalhe de cada um (ver getPurchaseExperienceDoItem). Paginação
// normal por offset (não precisa do scan/scroll de listarItensAtivos,
// porque paramos bem antes do teto de 1000 pelo cap abaixo). Loja com mais
// candidatos que o cap tem o resto ignorado nessa rodada — aviso explícito
// no log, nunca corta calado.
export async function buscarCandidatosSaudeReputacao(
  lojaId: number,
  mlUserId: number,
  gauge: "unhealthy" | "warning",
  cap: number = CAP_CANDIDATOS_POR_GAUGE
): Promise<string[]> {
  const accessToken = await getValidAccessToken(lojaId);
  const itemIds: string[] = [];
  let offset = 0;
  let total = 0;
  const limit = 50;

  while (itemIds.length < cap) {
    const { data } = await axios.get<{ results: string[]; paging: { total: number } }>(
      `${ML_API_BASE}/users/${mlUserId}/items/search`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { reputation_health_gauge: gauge, offset, limit },
      }
    );
    itemIds.push(...data.results);
    total = data.paging.total;
    if (data.results.length < limit) break;
    offset += limit;
  }

  if (total > cap) {
    console.warn(
      `[mercadoLivreApi] loja ${lojaId}: ${total} candidatos "${gauge}", checando só os primeiros ${cap}.`
    );
  }

  return itemIds.slice(0, cap);
}

export interface PurchaseExperienceDetalhe {
  color: string;
  value: number;
  text: string | null;
  motivoTexto: string | null;
  recomendacaoTexto: string | null;
}

// item_id não vem no corpo da resposta (só "up_id" pra item de catálogo) —
// quem chama já sabe o item_id, foi ele que passou na URL. "locale" é
// obrigatório (achado ao vivo: sem ele, 400 "Missing or invalid locale").
export async function getPurchaseExperienceDoItem(
  lojaId: number,
  itemId: string
): Promise<PurchaseExperienceDetalhe | null> {
  try {
    const accessToken = await getValidAccessToken(lojaId);
    const { data } = await axios.get<{
      reputation?: { color?: string; value?: number; text?: string };
      reasoning?: { subtitles?: { text?: string }[] };
      recommendations?: { subtitles?: { text?: string }[] };
      principal_actionable?: { text?: string };
    }>(`${ML_API_BASE}/reputation/items/${itemId}/purchase_experience/integrators`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { locale: "pt_BR" },
    });

    if (!data.reputation) return null;

    return {
      color: data.reputation.color ?? "gray",
      value: data.reputation.value ?? -1,
      text: data.reputation.text ?? null,
      motivoTexto: data.reasoning?.subtitles?.[0]?.text ?? null,
      recomendacaoTexto: data.recommendations?.subtitles?.[0]?.text ?? data.principal_actionable?.text ?? null,
    };
  } catch {
    return null;
  }
}

export interface MlPromocaoAtiva {
  ativa: boolean;
  precoPromocional: number | null;
}

// Igual ao endpoint de getPromocaoStatus, mas também captura o preço
// promocional (deal_price) quando a promoção está rodando — pro cálculo de
// margem simulada do anúncio (ver anunciosNegativosService.ts). Mesmo campo
// "deal_price" descoberto na resposta de listar itens de uma campanha (ver
// listarItensDaCampanha), aceito com fallback pra "price" por segurança.
export async function getPromocaoAtivaDoItem(lojaId: number, itemId: string): Promise<MlPromocaoAtiva> {
  try {
    const accessToken = await getValidAccessToken(lojaId);
    const { data } = await axios.get<Array<{ status: string; deal_price?: number; price?: number }>>(
      `${ML_API_BASE}/seller-promotions/items/${itemId}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, params: { app_version: "v2" } }
    );
    const ativa = data.find((p) => p.status === "started");
    if (!ativa) return { ativa: false, precoPromocional: null };
    return { ativa: true, precoPromocional: ativa.deal_price ?? ativa.price ?? null };
  } catch {
    return { ativa: false, precoPromocional: null };
  }
}

export interface MlPromocaoDoItem {
  promotionId: string;
  type: string;
  status: string;
  // Mesmo campo que getPromocaoAtivaDoItem já lê dessa resposta (deal_price
  // com fallback pra price) — capturado aqui também porque a descoberta
  // automática de campanhas (promocoesService.descobrirCampanhasNaLoja)
  // passou a montar a lista de itens da campanha a partir desse scan
  // item-a-item em vez do endpoint de listagem por campanha (paginação por
  // offset pouco confiável em campanha grande — ver obterItensDaCampanha).
  dealPrice: number | null;
  // Só vêm quando status === "candidate" (proposta ainda não aceita) — o ML
  // dá uma faixa de preço em vez do preço final, ver
  // promocoesOportunidadesService pro cálculo de margem em cima disso.
  minDiscountedPrice: number | null;
  maxDiscountedPrice: number | null;
  suggestedDiscountedPrice: number | null;
  name: string | null;
  // Só confirmado no tipo SMART ("Impulsione suas vendas"/"Aumente suas
  // vendas") — e, testado ao vivo, aparece mesmo com status "candidate"
  // (antes de entrar), não só "started". meliPercentage é o % do preço
  // original que o próprio Mercado Livre banca, sellerPercentage o % que
  // sai do bolso do vendedor — nos outros tipos (DEAL, PRICE_DISCOUNT,
  // SELLER_CAMPAIGN) esses campos nunca vêm, ou seja, não têm ajuda do ML
  // (ver promocoesOportunidadesService, que só automatiza SMART por causa
  // disso).
  meliPercentage: number | null;
  sellerPercentage: number | null;
  originalPrice: number | null;
  // Só no tipo SMART, formato "CANDIDATE-{itemId}-{n}" (candidate) ou
  // "OFFER-{itemId}-{n}" (started). Descoberto na marra: tentar aprovar
  // mandando só promotion_id devolveu 400 "Offer id is required" — é esse
  // campo que a API quer no join (ver adicionarItemCampanha).
  refId: string | null;
}

// Versão mais rica de getPromocaoStatus (que só devolve um enum
// simplificado) — devolve o promotion_id e o tipo de cada promoção que o
// item está, usada só na descoberta automática pra saber A QUAL campanha
// um item pertence, não só se está "em promoção" ou não.
export async function consultarPromocoesDoItem(lojaId: number, itemId: string): Promise<MlPromocaoDoItem[]> {
  const accessToken = await getValidAccessToken(lojaId);
  const { data } = await axios.get<
    Array<{
      id?: string;
      promotion_id?: string;
      type: string;
      status: string;
      deal_price?: number;
      price?: number;
      min_discounted_price?: number;
      max_discounted_price?: number;
      suggested_discounted_price?: number;
      name?: string;
      meli_percentage?: number;
      seller_percentage?: number;
      original_price?: number;
      ref_id?: string;
    }>
  >(`${ML_API_BASE}/seller-promotions/items/${itemId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { app_version: "v2" },
  });
  // MlCampanhaVendedor (resposta de criar/consultar uma promoção) usa "id",
  // não "promotion_id" — essa rota provavelmente segue o mesmo padrão. Não
  // temos uma resposta real confirmada pra essa rota especificamente, então
  // aceitamos os dois nomes em vez de arriscar quebrar de novo.
  return data.map((d) => ({
    promotionId: d.id ?? d.promotion_id ?? "",
    type: d.type,
    status: d.status,
    dealPrice: d.deal_price ?? d.price ?? null,
    minDiscountedPrice: d.min_discounted_price ?? null,
    maxDiscountedPrice: d.max_discounted_price ?? null,
    name: d.name || null,
    suggestedDiscountedPrice: d.suggested_discounted_price ?? null,
    meliPercentage: d.meli_percentage ?? null,
    sellerPercentage: d.seller_percentage ?? null,
    originalPrice: d.original_price ?? null,
    refId: d.ref_id ?? null,
  }));
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
    // Só grava no cache permanente se veio um custo de vendedor real
    // (> 0) — um envio muito recente (ver listarVendasRecentes, que agora
    // consulta quase em tempo real) pode responder R$0 porque o Mercado
    // Livre ainda não terminou de calcular o frete daquele envio. Cachear
    // esse R$0 pra sempre travaria o frete errado permanentemente; sem
    // cachear, a próxima consulta tenta de novo até vir o valor real.
    if (resultado.vendedor !== null && resultado.vendedor > 0) {
      cacheFreteEnvio.set(shippingId, resultado);
    }
    return resultado;
  } catch {
    return { vendedor: null, comprador: null, itensNoEnvio: 1 };
  }
}

// CEP fixo só pra ter um destino válido pra cotação — testado com 3 CEPs de
// regiões bem diferentes (SP/RJ/POA) e o list_cost saiu igual nos 3, então
// não parece variar por destino pra fins de estimativa (frete grátis
// costuma ter custo fixo pro vendedor, independente de pra onde vai).
const CEP_REFERENCIA_FRETE = "01310100";

// Estimativa de frete ANTES de vender (não existe pedido/envio real ainda,
// então não dá pra usar getCustoFreteDoEnvio). Descoberto comparando com o
// "Você recebe" real da tela de promoções do Mercado Livre: o list_cost
// daqui bate quase exato (diferença de centavos) com o que a própria tela
// do ML usa como estimativa. IMPORTANTE: list_cost é o custo "cheio" —
// getCustoFreteDoEnvio (envio de verdade, pedido já feito) documenta que o
// ML aplica um desconto obrigatório nesse valor na hora de cobrar de
// verdade, então o frete real tende a sair MENOR que essa estimativa (ou
// seja, a margem real tende a ficar um pouco MELHOR que essa estimativa,
// não pior) — só confirma de verdade comparando com uma venda real (ver
// compararComVendaReal em promocoesOportunidadesService).
export async function getFreteEstimadoPreVenda(lojaId: number, itemId: string): Promise<number | null> {
  try {
    const accessToken = await getValidAccessToken(lojaId);
    const { data } = await axios.get<{ options?: Array<{ list_cost?: number }> }>(
      `${ML_API_BASE}/items/${itemId}/shipping_options`,
      { headers: { Authorization: `Bearer ${accessToken}` }, params: { zip_code: CEP_REFERENCIA_FRETE } }
    );
    return data.options?.[0]?.list_cost ?? null;
  } catch {
    return null;
  }
}

export interface MlItemBasicInfo {
  id: string;
  title: string;
  price: number;
  thumbnail: string;
  permalink: string;
  // O ML devolve o objeto completo do item nessa rota mesmo sem pedir campo
  // por campo — reaproveitado pro snapshot de estoque (ver estoqueService) e
  // pro agente de catálogo (catalog_listing/category_id/listing_type_id/
  // seller_custom_field, ver agenteCatalogoService).
  available_quantity?: number;
  catalog_listing?: boolean;
  category_id?: string;
  listing_type_id?: string;
  seller_custom_field?: string | null;
  // Status real do anúncio (active/paused/closed/...) — capturado pra
  // investigar por que alguns itens com promoção "started" confirmada não
  // aparecem na varredura de descoberta (hipótese: não estão com
  // status=active, então nem entram na lista de itens ativos escaneada).
  status?: string;
  // Também já vem no objeto completo — capturado pra investigar se a
  // contagem de "anúncios" numa campanha do painel do Mercado Livre conta
  // cada variação (cor/tamanho) separadamente, enquanto a descoberta
  // automática de promoções conta por item pai só (ver diagnóstico em
  // promocoesService.descobrirCampanhasNaLoja).
  variations?: Array<{ id: number }>;
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

export interface MlPriceToWin {
  itemId: string;
  currentPrice: number;
  priceToWin: number | null;
  status: string; // "winning" | "competing" | "sharing_first_place" | "listed"
}

// Detalhe da concorrência de catálogo (ver
// developers.mercadolivre.com.br/pt_br/concorrencia-em-catalogo). Item que
// não compete em catálogo (não fez opt-in) dá 404 — trata como "sem dado"
// em vez de derrubar o loop de itens da loja inteira.
export async function getPriceToWin(lojaId: number, itemId: string): Promise<MlPriceToWin | null> {
  try {
    const accessToken = await getValidAccessToken(lojaId);
    const { data } = await axios.get<{
      item_id: string;
      current_price: number;
      price_to_win: number | null;
      status: string;
    }>(`${ML_API_BASE}/items/${itemId}/price_to_win`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { version: "v2" },
    });
    return { itemId: data.item_id, currentPrice: data.current_price, priceToWin: data.price_to_win, status: data.status };
  } catch {
    return null;
  }
}

// Custo real de vender pelo ML num preço hipotético (taxa da categoria +
// tipo de anúncio) — usado pra saber se baixar até o price_to_win ainda
// deixa margem. Passando category_id + listing_type_id juntos o ML devolve
// um objeto único (confirmado na doc oficial "Custos por vender"); aceita
// os dois formatos por segurança, já que outras chamadas dessa API já
// vieram em formato inesperado antes (ver comentário em getAnunciosAds).
export async function getTaxaMlParaPreco(
  lojaId: number,
  categoryId: string,
  listingTypeId: string,
  price: number
): Promise<number | null> {
  try {
    const accessToken = await getValidAccessToken(lojaId);
    const { data } = await axios.get<
      { sale_fee_amount: number } | Array<{ sale_fee_amount: number; listing_type_id: string }>
    >(`${ML_API_BASE}/sites/MLB/listing_prices`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { price, category_id: categoryId, listing_type_id: listingTypeId },
    });
    const entrada = Array.isArray(data) ? (data.find((d) => d.listing_type_id === listingTypeId) ?? data[0]) : data;
    return entrada?.sale_fee_amount ?? null;
  } catch {
    return null;
  }
}

// Visitas de um único anúncio numa janela de datas (máx. 150 dias) — a API
// do ML só aceita 1 item por chamada nessa rota com data (diferente da rota
// sem data, que aceita vários ids de uma vez), por isso é chamada em loop
// com concorrência limitada pelo agente de conversão.
export async function getVisitasItem(lojaId: number, itemId: string, dataInicio: string, dataFim: string): Promise<number | null> {
  try {
    const accessToken = await getValidAccessToken(lojaId);
    const { data } = await axios.get<{ total_visits: number }>(`${ML_API_BASE}/items/visits`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { ids: itemId, date_from: dataInicio, date_to: dataFim },
    });
    return data.total_visits;
  } catch (err) {
    // Logado (não só engolido) — null aqui vira "0 visitas" na análise de
    // conversão (ver coletarConversaoDaLoja em agenteConversaoService.ts),
    // que some silenciosamente do relatório se ficar indistinguível de uma
    // falha real de API. O log é o que permite diferenciar as duas coisas.
    console.error(`getVisitasItem: falha ao buscar visitas do item ${itemId} (loja ${lojaId}):`, err);
    return null;
  }
}

// Total de visitas da CONTA inteira (todos os anúncios juntos) numa janela
// de datas — 1 chamada por loja, bem mais barato que somar visita por item
// (usado pro resumo do escritório, que só precisa do número agregado, não
// item por item).
export async function getVisitasContaHoje(
  lojaId: number,
  mlUserId: number,
  dataInicio: string,
  dataFim: string
): Promise<number | null> {
  try {
    const accessToken = await getValidAccessToken(lojaId);
    const { data } = await axios.get<{ total_visits: number }>(`${ML_API_BASE}/users/${mlUserId}/items_visits`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { date_from: dataInicio, date_to: dataFim },
    });
    return data.total_visits;
  } catch {
    return null;
  }
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

export interface MlAnuncioAds {
  item_id: string;
  campaign_id: number;
  title: string;
  status: string;
  metrics: {
    clicks: number;
    prints: number;
    cost: number;
    cpc: number;
    direct_amount: number;
    indirect_amount: number;
    total_amount: number;
    acos: number;
  };
}

// Anúncio individual dentro de uma campanha — diferente de MlCampanhaAds
// (que é a campanha inteira, podendo ter vários produtos). Cada anúncio
// aqui já vem com o item_id do MLB, que é o mesmo id usado nas vendas do
// Financeiro — dá pra cruzar gasto de Ads com receita real por produto sem
// depender do nome da campanha.
export async function getAnunciosAds(
  lojaId: number,
  advertiserId: number,
  dateFrom: string,
  dateTo: string
): Promise<MlAnuncioAds[]> {
  const accessToken = await getValidAccessToken(lojaId);
  const headers = { Authorization: `Bearer ${accessToken}`, "api-version": "2" };
  const metrics = "clicks,prints,cost,cpc,acos,direct_amount,indirect_amount,total_amount";

  const anuncios: MlAnuncioAds[] = [];
  let offset = 0;
  const limit = 50;
  while (true) {
    const { data } = await axios.get<{ paging: { total: number }; results: MlAnuncioAds[] }>(
      `${ML_API_BASE}/marketplace/advertising/MLB/advertisers/${advertiserId}/product_ads/ads/search`,
      { headers, params: { limit, offset, date_from: dateFrom, date_to: dateTo, metrics } }
    );
    anuncios.push(...data.results);
    offset += limit;
    if (offset >= data.paging.total || data.results.length === 0) break;
  }
  return anuncios;
}
