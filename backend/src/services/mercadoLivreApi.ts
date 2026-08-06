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

// Adiciona um item à campanha com o preço final já calculado (não manda
// percentual pra API — o Mercado Livre trabalha com preço final em R$ por
// item, ver deal_price).
export async function adicionarItemCampanha(
  lojaId: number,
  itemId: string,
  promotionId: string,
  dealPrice: number
): Promise<void> {
  const accessToken = await getValidAccessToken(lojaId);
  await axios.post(
    `${ML_API_BASE}/seller-promotions/items/${itemId}`,
    { promotion_id: promotionId, promotion_type: "SELLER_CAMPAIGN", deal_price: dealPrice },
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

// Diagnóstico temporário: devolve a resposta crua de /items pra essa
// campanha, sem tentar interpretar o formato. Usado só quando
// obterItensDaCampanha volta 0 itens pra uma campanha que o próprio ML
// mostra ter itens vinculados — em vez de adivinhar o formato de novo,
// isso deixa a gente ver a resposta real na tela (ver amostraErro em
// promocoesService.descobrirCampanhasNaLoja). Remover depois de resolvido.
export async function obterItensDaCampanhaBruto(lojaId: number, promotionId: string): Promise<string> {
  const accessToken = await getValidAccessToken(lojaId);
  const { data } = await axios.get(`${ML_API_BASE}/seller-promotions/promotions/${promotionId}/items`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { promotion_type: "SELLER_CAMPAIGN", app_version: "v2", offset: 0, limit: 50 },
  });
  return JSON.stringify(data).slice(0, 600);
}

export async function obterItensDaCampanha(lojaId: number, promotionId: string): Promise<MlItemCampanha[]> {
  const accessToken = await getValidAccessToken(lojaId);
  const itensPorId = new Map<string, MlItemCampanha>();
  const idsVistos = new Set<string>();
  let offset = 0;
  const limit = 50;
  // Trava de segurança (5000 itens) — visto na prática que data.paging.total
  // pode não refletir o total real de itens distintos dessa campanha.
  const MAX_PAGINAS = 100;
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const { data } = await axios.get<{
      results: Array<{
        id: string;
        status: string;
        price?: number;
        deal_price?: number;
        original_price: number;
      }>;
      paging: { total: number };
    }>(`${ML_API_BASE}/seller-promotions/promotions/${promotionId}/items`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { promotion_type: "SELLER_CAMPAIGN", app_version: "v2", offset, limit },
    });

    let paginaTemNovidade = false;
    for (const r of data.results) {
      if (!idsVistos.has(r.id)) {
        idsVistos.add(r.id);
        paginaTemNovidade = true;
      }
      // Confirmado numa resposta real: item "candidate" não tem price, só
      // min/max/suggested_discounted_price (é só uma SUGESTÃO do ML de item
      // elegível, não um item de fato incluído na campanha) — e não vem com
      // o mesmo nome de campo "price" que a gente assumia, é "deal_price"
      // (mesmo nome usado pra ENVIAR o preço em adicionarItemCampanha). Só
      // item started conta como "na campanha" de verdade.
      const preco = r.deal_price ?? r.price;
      if (r.status === "started" && typeof preco === "number" && !itensPorId.has(r.id)) {
        itensPorId.set(r.id, { itemId: r.id, status: r.status, price: preco, originalPrice: r.original_price });
      }
    }

    offset += limit;
    // Página inteira repetindo ids já vistos = a API não está avançando de
    // verdade (visto na prática: mesmo item devolvido em toda página) — para
    // aqui em vez de insistir até bater em paging.total, evitando duplicar
    // o mesmo item dezenas de vezes no resultado final.
    if (data.results.length === 0 || !paginaTemNovidade || offset >= data.paging.total) break;
  }
  return Array.from(itensPorId.values());
}

// Lista o item_id de todos os anúncios ATIVOS de uma loja — usada só pra
// descoberta automática de campanhas já existentes (ver
// promocoesService.descobrirCampanhas): não tem outro jeito de achar
// "quais anúncios estão em promoção" sem checar anúncio por anúncio, já
// que o Mercado Livre não tem endpoint de "listar minhas campanhas".
export async function listarItensAtivos(lojaId: number, mlUserId: number): Promise<string[]> {
  const accessToken = await getValidAccessToken(lojaId);
  const itemIds: string[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const { data } = await axios.get<{ results: string[]; paging: { total: number } }>(
      `${ML_API_BASE}/users/${mlUserId}/items/search`,
      { headers: { Authorization: `Bearer ${accessToken}` }, params: { status: "active", offset, limit } }
    );
    itemIds.push(...data.results);
    offset += limit;
    // A busca de itens do ML não pagina além de 1000 por essa rota — se a
    // loja tiver mais que isso ativo, para aqui em vez de tentar offset
    // inválido (evita erro, aceita a limitação em vez de quebrar o scan).
    if (offset >= data.paging.total || data.results.length === 0 || offset >= 1000) break;
  }
  return itemIds;
}

export interface MlPromocaoDoItem {
  promotionId: string;
  type: string;
  status: string;
}

// Versão mais rica de getPromocaoStatus (que só devolve um enum
// simplificado) — devolve o promotion_id e o tipo de cada promoção que o
// item está, usada só na descoberta automática pra saber A QUAL campanha
// um item pertence, não só se está "em promoção" ou não.
export async function consultarPromocoesDoItem(lojaId: number, itemId: string): Promise<MlPromocaoDoItem[]> {
  const accessToken = await getValidAccessToken(lojaId);
  const { data } = await axios.get<Array<{ id?: string; promotion_id?: string; type: string; status: string }>>(
    `${ML_API_BASE}/seller-promotions/items/${itemId}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, params: { app_version: "v2" } }
  );
  // MlCampanhaVendedor (resposta de criar/consultar uma promoção) usa "id",
  // não "promotion_id" — essa rota provavelmente segue o mesmo padrão. Não
  // temos uma resposta real confirmada pra essa rota especificamente, então
  // aceitamos os dois nomes em vez de arriscar quebrar de novo.
  return data.map((d) => ({ promotionId: d.id ?? d.promotion_id ?? "", type: d.type, status: d.status }));
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
