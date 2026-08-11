import { pool } from "../db/pool";
import { listLojas } from "./tokenStore";
import { getAdvertiserId, getCampanhasAds, MlCampanhaAds } from "./mercadoLivreApi";
import { janelaHoje, chaveJanelaDoDia } from "./dateUtils";

export interface CampanhaAds {
  lojaId: number;
  lojaNome: string;
  campanhaId: number;
  nome: string;
  status: string;
  orcamento: number;
  acosMeta: number;
  // Meta capturada no snapshot mais antigo dentro do período consultado —
  // só vem preenchida quando é diferente da meta atual (acosMeta), pra
  // avisar que a meta mudou em algum momento durante o período em vez de
  // mostrar sempre a meta "de agora" como se tivesse valido o período todo.
  acosMetaAnterior: number | null;
  cliques: number;
  impressoes: number;
  custo: number;
  cpc: number;
  vendasDiretas: number;
  vendasIndiretas: number;
  vendasTotais: number;
  acos: number;
}

function mapearCampanha(
  lojaId: number,
  lojaNome: string,
  c: MlCampanhaAds,
  acosMetaAnterior: number | null
): CampanhaAds {
  return {
    lojaId,
    lojaNome,
    campanhaId: c.id,
    nome: c.name,
    status: c.status,
    orcamento: c.budget,
    acosMeta: c.acos_target,
    acosMetaAnterior: acosMetaAnterior !== null && acosMetaAnterior !== c.acos_target ? acosMetaAnterior : null,
    cliques: c.metrics.clicks,
    impressoes: c.metrics.prints,
    custo: c.metrics.cost,
    cpc: c.metrics.cpc,
    vendasDiretas: c.metrics.direct_amount,
    vendasIndiretas: c.metrics.indirect_amount,
    vendasTotais: c.metrics.total_amount,
    acos: c.metrics.acos,
  };
}

// Busca, pra cada campanha, a meta capturada no snapshot MAIS ANTIGO dentro
// do período consultado — representa a meta que estava valendo no começo
// da janela. Comparado com a meta atual (que a API sempre devolve "de
// agora"), dá pra perceber quando o usuário mudou a meta no meio do
// período, em vez de aplicar retroativamente a meta atual pro período
// inteiro (foi exatamente essa confusão que gerou uma análise errada antes
// dessa feature existir).
async function obterMetaAntigaPorCampanha(
  lojaIds: number[],
  dataInicio: string,
  dataFim: string
): Promise<Map<string, number>> {
  if (lojaIds.length === 0) return new Map();
  const { rows } = await pool.query<{ loja_id: number; campanha_id: string; acos_meta: string | null }>(
    `SELECT DISTINCT ON (loja_id, campanha_id) loja_id, campanha_id, acos_meta
     FROM ads_gasto_diario
     WHERE loja_id = ANY($1) AND data BETWEEN $2 AND $3 AND acos_meta IS NOT NULL
     ORDER BY loja_id, campanha_id, data ASC`,
    [lojaIds, dataInicio, dataFim]
  );
  const mapa = new Map<string, number>();
  for (const r of rows) {
    mapa.set(`${r.loja_id}-${r.campanha_id}`, Number(r.acos_meta));
  }
  return mapa;
}

// Cache curto — mesma lógica do Financeiro: janela de 15 min, com opção de
// forçar (botão "Atualizar" na tela).
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { data: CampanhaAds[]; expiraEm: number }>();

export async function listarCampanhasAds(
  lojaIdFiltro?: number,
  lojasPermitidas?: number[],
  dataInicio?: string,
  dataFim?: string,
  forcarAtualizacao = false
): Promise<CampanhaAds[]> {
  const lojas = (await listLojas()).filter(
    (l) =>
      l.ml_user_id !== null &&
      (lojaIdFiltro === undefined || l.id === lojaIdFiltro) &&
      (lojasPermitidas === undefined || lojasPermitidas.includes(l.id))
  );

  const chaveCache = `${lojas
    .map((l) => l.id)
    .sort((a, b) => a - b)
    .join(",")}|${dataInicio ?? ""}|${dataFim ?? ""}`;
  const emCache = cache.get(chaveCache);
  if (!forcarAtualizacao && emCache && emCache.expiraEm > Date.now()) {
    return emCache.data;
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dateFrom = dataInicio ?? seteDiasAtras;
  const dateTo = dataFim ?? hoje;

  const metaAnteriorPorCampanha = await obterMetaAntigaPorCampanha(
    lojas.map((l) => l.id),
    dateFrom,
    dateTo
  );

  const porLoja = await Promise.all(
    lojas.map(async (loja) => {
      const advertiserId = await getAdvertiserId(loja.id);
      if (advertiserId === null) return [];
      try {
        const campanhas = await getCampanhasAds(loja.id, advertiserId, dateFrom, dateTo);
        return campanhas.map((c) =>
          mapearCampanha(loja.id, loja.nome, c, metaAnteriorPorCampanha.get(`${loja.id}-${c.id}`) ?? null)
        );
      } catch {
        return [];
      }
    })
  );

  const resultado = porLoja.flat();
  cache.set(chaveCache, { data: resultado, expiraEm: Date.now() + CACHE_TTL_MS });
  return resultado;
}

// Captura o gasto de hoje de cada campanha (de todas as lojas autorizadas) e
// guarda no banco — chamado periodicamente (ver iniciarSnapshotAds). O
// Mercado Livre "esquece" o gasto de campanhas excluídas na API de
// campanhas; guardando aqui antes disso acontecer, o histórico sobrevive.
export async function capturarGastoAdsDoDia(): Promise<void> {
  const hoje = janelaHoje().agora.slice(0, 10);
  const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null);

  for (const loja of lojas) {
    try {
      const advertiserId = await getAdvertiserId(loja.id);
      if (advertiserId === null) continue;
      const campanhas = await getCampanhasAds(loja.id, advertiserId, hoje, hoje);
      for (const c of campanhas) {
        await pool.query(
          `INSERT INTO ads_gasto_diario (loja_id, campanha_id, data, nome, custo, acos_meta, atualizado_em)
           VALUES ($1, $2, $3, $4, $5, $6, now())
           ON CONFLICT (loja_id, campanha_id, data) DO UPDATE SET custo = $5, nome = $4, acos_meta = $6, atualizado_em = now()`,
          [loja.id, c.id, hoje, c.name, c.metrics.cost, c.acos_target]
        );
      }
    } catch (err) {
      console.error(`Erro ao capturar snapshot de ads da loja ${loja.id}:`, err);
    }
  }
}

// Ao vivo é a fonte de verdade — confirmado bater exato com o Mercado Livre
// (total e por campanha; ver histórico de investigação de 11/08/2026). A
// soma dia a dia do retrato salvo (ads_gasto_diario) tinha uma imprecisão
// sistemática de ~9% mesmo em dias sem nenhum problema de captura — por
// isso não soma mais o retrato direto. O retrato agora só serve pra
// recuperar o gasto de campanhas que foram EXCLUÍDAS e por isso sumiram da
// busca ao vivo (o Mercado Livre "esquece" campanha excluída ao consultar
// ao vivo) — reaproveita listarCampanhasAds (mesma busca+cache da tela de
// Gestão de Ads) em vez de duplicar a chamada à API.
export async function obterGastoAdsHistorico(
  lojaIdFiltro?: number,
  lojasPermitidas?: number[],
  dataInicio?: string,
  dataFim?: string
): Promise<number> {
  const lojas = (await listLojas()).filter(
    (l) =>
      l.ml_user_id !== null &&
      (lojaIdFiltro === undefined || l.id === lojaIdFiltro) &&
      (lojasPermitidas === undefined || lojasPermitidas.includes(l.id))
  );
  if (lojas.length === 0) return 0;

  const hoje = janelaHoje().agora.slice(0, 10);
  const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dataInicioReal = dataInicio ?? seteDiasAtras;
  const dataFimReal = dataFim ?? hoje;

  const campanhasAoVivo = await listarCampanhasAds(lojaIdFiltro, lojasPermitidas, dataInicioReal, dataFimReal);
  let total = campanhasAoVivo.reduce((soma, c) => soma + c.custo, 0);

  const idsAoVivoPorLoja = new Map<number, Set<number>>();
  for (const c of campanhasAoVivo) {
    if (!idsAoVivoPorLoja.has(c.lojaId)) idsAoVivoPorLoja.set(c.lojaId, new Set());
    idsAoVivoPorLoja.get(c.lojaId)!.add(c.campanhaId);
  }

  const lojaIds = lojas.map((l) => l.id);
  const { rows } = await pool.query<{ loja_id: number; campanha_id: string; soma: string }>(
    `SELECT loja_id, campanha_id, SUM(custo) AS soma FROM ads_gasto_diario
     WHERE loja_id = ANY($1) AND data BETWEEN $2 AND $3
     GROUP BY loja_id, campanha_id`,
    [lojaIds, dataInicioReal, dataFimReal]
  );
  for (const r of rows) {
    const idsDaLoja = idsAoVivoPorLoja.get(r.loja_id) ?? new Set<number>();
    if (!idsDaLoja.has(Number(r.campanha_id))) {
      total += Number(r.soma);
    }
  }

  return total;
}

const HORARIOS_SNAPSHOT_ADS = [0, 4, 8, 12, 16, 20];
const INTERVALO_VERIFICACAO_MS = 5 * 60 * 1000;

let ultimaJanelaCapturada: string | null = null;

// Roda em segundo plano desde a inicialização do servidor — a cada 4h,
// captura o gasto do dia de cada campanha (ver capturarGastoAdsDoDia). Isso
// limita a janela de risco de perder o histórico de uma campanha excluída a
// "algumas horas", em vez de "pra sempre" (que era o caso antes, já que só
// olhávamos a API ao vivo, sem guardar nada).
export function iniciarSnapshotAds(): void {
  async function verificar() {
    const janelaAtual = chaveJanelaDoDia(HORARIOS_SNAPSHOT_ADS);
    if (janelaAtual !== ultimaJanelaCapturada) {
      ultimaJanelaCapturada = janelaAtual;
      await capturarGastoAdsDoDia();
      console.log("Snapshot de gasto de Ads concluído.");
    }
  }

  verificar();
  setInterval(verificar, INTERVALO_VERIFICACAO_MS);
}
