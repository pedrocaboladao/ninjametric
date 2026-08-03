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
  cliques: number;
  impressoes: number;
  custo: number;
  cpc: number;
  vendasDiretas: number;
  vendasIndiretas: number;
  vendasTotais: number;
  acos: number;
}

function mapearCampanha(lojaId: number, lojaNome: string, c: MlCampanhaAds): CampanhaAds {
  return {
    lojaId,
    lojaNome,
    campanhaId: c.id,
    nome: c.name,
    status: c.status,
    orcamento: c.budget,
    acosMeta: c.acos_target,
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

  const porLoja = await Promise.all(
    lojas.map(async (loja) => {
      const advertiserId = await getAdvertiserId(loja.id);
      if (advertiserId === null) return [];
      try {
        const campanhas = await getCampanhasAds(loja.id, advertiserId, dateFrom, dateTo);
        return campanhas.map((c) => mapearCampanha(loja.id, loja.nome, c));
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
          `INSERT INTO ads_gasto_diario (loja_id, campanha_id, data, nome, custo, atualizado_em)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (loja_id, campanha_id, data) DO UPDATE SET custo = $5, nome = $4, atualizado_em = now()`,
          [loja.id, c.id, hoje, c.name, c.metrics.cost]
        );
      }
    } catch (err) {
      console.error(`Erro ao capturar snapshot de ads da loja ${loja.id}:`, err);
    }
  }
}

// Soma o gasto de Ads guardado no nosso histórico (sobrevive a campanhas
// excluídas). Se não tiver nada guardado no período (datas antes do
// snapshot existir, ou nenhuma campanha rodou), cai pro total ao vivo — que
// é o comportamento de antes, só não é imune a campanhas já excluídas.
export async function obterGastoAdsHistorico(
  lojaIdFiltro?: number,
  lojasPermitidas?: number[],
  dataInicio?: string,
  dataFim?: string,
  forcarAtualizacao = false
): Promise<number> {
  const lojas = (await listLojas()).filter(
    (l) =>
      l.ml_user_id !== null &&
      (lojaIdFiltro === undefined || l.id === lojaIdFiltro) &&
      (lojasPermitidas === undefined || lojasPermitidas.includes(l.id))
  );
  const lojaIds = lojas.map((l) => l.id);
  if (lojaIds.length === 0) return 0;

  const hoje = janelaHoje().agora.slice(0, 10);
  const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dataInicioReal = dataInicio ?? seteDiasAtras;
  const dataFimReal = dataFim ?? hoje;

  const { rows } = await pool.query<{ soma: string | null }>(
    `SELECT SUM(custo) AS soma FROM ads_gasto_diario WHERE loja_id = ANY($1) AND data BETWEEN $2 AND $3`,
    [lojaIds, dataInicioReal, dataFimReal]
  );
  const somaSnapshot = Number(rows[0]?.soma ?? 0);
  if (somaSnapshot > 0) return somaSnapshot;

  const campanhas = await listarCampanhasAds(lojaIdFiltro, lojasPermitidas, dataInicio, dataFim, forcarAtualizacao);
  return campanhas.reduce((soma, c) => soma + c.custo, 0);
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
