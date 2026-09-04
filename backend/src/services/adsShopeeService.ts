import { pool } from "../db/pool";
import { chamarApiAssinada } from "./shopeeAuth";
import { listarVendasFinanceirasShopee } from "./financeiroShopeeService";

export interface CampanhaAdsShopee {
  lojaId: number;
  lojaNome: string;
  campanhaId: number;
  nome: string;
  status: string;
  tipoAnuncio: string;
  orcamento: number;
  // null quando a campanha usa lance manual (a Shopee não devolve meta
  // nesse caso, achado ao vivo) — front trata como "sem meta configurada",
  // não como 0.
  acosMeta: number | null;
  cliques: number;
  impressoes: number;
  custo: number;
  cpc: number;
  vendasDiretas: number;
  vendasIndiretas: number;
  vendasTotais: number;
  acos: number;
  tacosReal: number | null;
  acosIdeal: number | null;
  lucroReais: number | null;
}

interface LojaShopee {
  id: number;
  nome: string;
}

// Mesma query de financeiroShopeeService.ts (listarLojasComShopee) —
// duplicada de propósito, convenção do projeto (ver resolverLojaFiltro
// duplicado por rota).
async function listarLojasComShopeeAds(lojaIdFiltro?: number, lojasPermitidas?: number[]): Promise<LojaShopee[]> {
  const { rows } = await pool.query<LojaShopee>(
    `SELECT l.id, l.nome FROM lojas l JOIN contas_shopee c ON c.loja_id = l.id ORDER BY l.id`
  );
  return rows.filter(
    (l) => (lojaIdFiltro === undefined || l.id === lojaIdFiltro) && (lojasPermitidas === undefined || lojasPermitidas.includes(l.id))
  );
}

// A Shopee quer DD-MM-YYYY nesses endpoints de Ads (achado ao vivo, ver
// shopeeAdsService.ts) — diferente do resto da API, que usa AAAA-MM-DD.
function paraDDMMYYYY(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-");
  return `${dia}-${mes}-${ano}`;
}

// Cap de segurança contra loop infinito/paginação quebrada — nunca deveria
// bater nisso na prática (seria >5000 campanhas numa loja só), mas se
// bater, avisa em vez de cortar silenciosamente.
const PAGINAS_MAX_CAMPANHAS = 20;
const TAMANHO_PAGINA = 100;
// Limite documentado pelo próprio erro da Shopee: "pass a maximum of 100
// comma separated campaign_ids".
const LOTE_MAX = 100;

interface RespostaListaCampanhas {
  error?: string;
  message?: string;
  response?: { has_next_page?: boolean; campaign_list?: { ad_type: string; campaign_id: number }[] };
}

async function buscarCampanhaIdsDaLoja(lojaId: number): Promise<{ campaignId: number; tipoAnuncio: string }[]> {
  const resultado: { campaignId: number; tipoAnuncio: string }[] = [];
  for (let pagina = 0; pagina < PAGINAS_MAX_CAMPANHAS; pagina++) {
    const data = await chamarApiAssinada<RespostaListaCampanhas>(lojaId, "/api/v2/ads/get_product_level_campaign_id_list", {
      ad_type: "all",
      campaign_status: "all",
      offset: pagina * TAMANHO_PAGINA,
      limit: TAMANHO_PAGINA,
    });
    if (data.error) throw new Error(`${data.error}: ${data.message ?? ""}`);
    const lista = data.response?.campaign_list ?? [];
    for (const c of lista) resultado.push({ campaignId: c.campaign_id, tipoAnuncio: c.ad_type });
    if (!data.response?.has_next_page) return resultado;
  }
  console.warn(
    `adsShopeeService: loja ${lojaId} tem mais de ${PAGINAS_MAX_CAMPANHAS * TAMANHO_PAGINA} campanhas de Ads — lista cortada, resultado incompleto.`
  );
  return resultado;
}

function loteados<T>(itens: T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

interface InfoCampanha {
  nome: string;
  status: string;
  orcamento: number;
  roasMeta: number | null;
  itemIds: number[];
}

interface RespostaInfoCampanhas {
  error?: string;
  message?: string;
  response?: {
    campaign_list?: {
      campaign_id: number;
      common_info: {
        ad_name: string;
        campaign_status: string;
        campaign_budget: number;
        item_id_list: number[];
      };
      auto_bidding_info?: { roas_target?: number } | null;
    }[];
  };
}

async function buscarDetalhesCampanhas(lojaId: number, campaignIds: number[]): Promise<Map<number, InfoCampanha>> {
  const mapa = new Map<number, InfoCampanha>();
  for (const lote of loteados(campaignIds, LOTE_MAX)) {
    const data = await chamarApiAssinada<RespostaInfoCampanhas>(lojaId, "/api/v2/ads/get_product_level_campaign_setting_info", {
      campaign_id_list: lote.join(","),
      info_type_list: "1,2,3,4",
    });
    if (data.error) throw new Error(`${data.error}: ${data.message ?? ""}`);
    for (const c of data.response?.campaign_list ?? []) {
      mapa.set(c.campaign_id, {
        nome: c.common_info.ad_name,
        status: c.common_info.campaign_status,
        orcamento: c.common_info.campaign_budget,
        roasMeta: c.auto_bidding_info?.roas_target ?? null,
        itemIds: c.common_info.item_id_list ?? [],
      });
    }
  }
  return mapa;
}

interface Performance {
  cliques: number;
  impressoes: number;
  custo: number;
  vendasDiretas: number;
  vendasTotais: number;
  receitaTotal: number;
}

interface RespostaPerformanceCampanhas {
  error?: string;
  message?: string;
  response?: {
    campaign_list?: {
      campaign_id: number;
      metrics_list: { impression: number; clicks: number; expense: number; direct_order: number; broad_order: number; broad_gmv: number }[];
    }[];
  };
}

async function buscarPerformanceCampanhas(
  lojaId: number,
  campaignIds: number[],
  dataInicio: string,
  dataFim: string
): Promise<Map<number, Performance>> {
  const mapa = new Map<number, Performance>();
  for (const lote of loteados(campaignIds, LOTE_MAX)) {
    const data = await chamarApiAssinada<RespostaPerformanceCampanhas>(lojaId, "/api/v2/ads/get_product_campaign_daily_performance", {
      campaign_id_list: lote.join(","),
      start_date: paraDDMMYYYY(dataInicio),
      end_date: paraDDMMYYYY(dataFim),
    });
    if (data.error) throw new Error(`${data.error}: ${data.message ?? ""}`);
    for (const c of data.response?.campaign_list ?? []) {
      const acumulado = c.metrics_list.reduce(
        (soma, dia) => ({
          cliques: soma.cliques + (dia.clicks ?? 0),
          impressoes: soma.impressoes + (dia.impression ?? 0),
          custo: soma.custo + (dia.expense ?? 0),
          vendasDiretas: soma.vendasDiretas + (dia.direct_order ?? 0),
          vendasTotais: soma.vendasTotais + (dia.broad_order ?? 0),
          receitaTotal: soma.receitaTotal + (dia.broad_gmv ?? 0),
        }),
        { cliques: 0, impressoes: 0, custo: 0, vendasDiretas: 0, vendasTotais: 0, receitaTotal: 0 }
      );
      mapa.set(c.campaign_id, acumulado);
    }
  }
  return mapa;
}

// Cache de 15 min, mesmo padrão de adsService.ts/listarVendasFinanceiras —
// feed de atividade recente, não precisa reprocessar tudo a cada request.
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { data: CampanhaAdsShopee[]; expiraEm: number }>();

export async function listarCampanhasAdsShopee(
  lojaIdFiltro: number | undefined,
  lojasPermitidas: number[] | undefined,
  dataInicio: string,
  dataFim: string,
  forcarAtualizacao = false
): Promise<CampanhaAdsShopee[]> {
  const lojas = await listarLojasComShopeeAds(lojaIdFiltro, lojasPermitidas);

  const chaveCache = `${lojas
    .map((l) => l.id)
    .sort((a, b) => a - b)
    .join(",")}|${dataInicio}|${dataFim}`;
  const emCache = cache.get(chaveCache);
  if (!forcarAtualizacao && emCache && emCache.expiraEm > Date.now()) {
    return emCache.data;
  }

  // Vendas reais do período (Financeiro Shopee) — cruzadas por item_id pra
  // TACOS real/margem, mesmo padrão de tacosService.ts (ML).
  let vendas: Awaited<ReturnType<typeof listarVendasFinanceirasShopee>>["vendas"] = [];
  try {
    vendas = (await listarVendasFinanceirasShopee(lojaIdFiltro, lojasPermitidas, dataInicio, dataFim)).vendas;
  } catch (err) {
    console.error("adsShopeeService: falha ao buscar vendas do Financeiro Shopee, seguindo sem TACOS real:", err);
  }
  const receitaPorItem = new Map<number, number>();
  const margemPorItem = new Map<number, number>();
  for (const v of vendas) {
    receitaPorItem.set(v.itemId, (receitaPorItem.get(v.itemId) ?? 0) + v.receitaTotal);
    if (v.margemContribuicao !== null) {
      margemPorItem.set(v.itemId, (margemPorItem.get(v.itemId) ?? 0) + v.margemContribuicao);
    }
  }

  const porLoja = await Promise.all(
    lojas.map(async (loja): Promise<CampanhaAdsShopee[]> => {
      try {
        const idsComTipo = await buscarCampanhaIdsDaLoja(loja.id);
        const campaignIds = idsComTipo.map((c) => c.campaignId);
        if (campaignIds.length === 0) return [];

        const [detalhes, performance] = await Promise.all([
          buscarDetalhesCampanhas(loja.id, campaignIds),
          buscarPerformanceCampanhas(loja.id, campaignIds, dataInicio, dataFim),
        ]);

        return idsComTipo
          .map(({ campaignId, tipoAnuncio }): CampanhaAdsShopee | null => {
            const info = detalhes.get(campaignId);
            const perf = performance.get(campaignId);
            if (!info || !perf) return null;

            const custo = perf.custo;
            const receitaAds = perf.receitaTotal;
            const acos = custo > 0 && receitaAds > 0 ? (custo / receitaAds) * 100 : 0;
            const cpc = perf.cliques > 0 ? custo / perf.cliques : 0;

            let receitaReal = 0;
            let margemReal = 0;
            let temItemComMargem = false;
            for (const itemId of info.itemIds) {
              receitaReal += receitaPorItem.get(itemId) ?? 0;
              if (margemPorItem.has(itemId)) {
                temItemComMargem = true;
                margemReal += margemPorItem.get(itemId) ?? 0;
              }
            }
            const receitaBase = Math.max(receitaReal, receitaAds);
            const tacosReal = receitaBase > 0 ? (custo / receitaBase) * 100 : null;
            const acosIdeal = temItemComMargem && receitaReal > 0 ? (margemReal / receitaReal) * 100 : null;
            const lucroReais = temItemComMargem ? margemReal - custo : null;

            return {
              lojaId: loja.id,
              lojaNome: loja.nome,
              campanhaId: campaignId,
              nome: info.nome,
              status: info.status,
              tipoAnuncio,
              orcamento: info.orcamento,
              acosMeta: info.roasMeta !== null && info.roasMeta > 0 ? 100 / info.roasMeta : null,
              cliques: perf.cliques,
              impressoes: perf.impressoes,
              custo,
              cpc,
              vendasDiretas: perf.vendasDiretas,
              vendasIndiretas: Math.max(0, perf.vendasTotais - perf.vendasDiretas),
              vendasTotais: perf.vendasTotais,
              acos,
              tacosReal,
              acosIdeal,
              lucroReais,
            };
          })
          .filter((c): c is CampanhaAdsShopee => c !== null);
      } catch (err) {
        console.error(`adsShopeeService: falha na loja ${loja.id}, pulando essa loja nessa rodada:`, err);
        return [];
      }
    })
  );

  const resultado = porLoja.flat();
  cache.set(chaveCache, { data: resultado, expiraEm: Date.now() + CACHE_TTL_MS });
  return resultado;
}
