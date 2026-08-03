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

function listarDiasEntre(inicio: string, fim: string): string[] {
  const dias: string[] = [];
  let atual = new Date(`${inicio}T00:00:00Z`);
  const fimData = new Date(`${fim}T00:00:00Z`);
  while (atual <= fimData) {
    dias.push(atual.toISOString().slice(0, 10));
    atual = new Date(atual.getTime() + 24 * 60 * 60 * 1000);
  }
  return dias;
}

// Agrupa dias soltos (ex.: [01,02,03,10,11]) em faixas contínuas
// ([{01,03},{10,11}]) — pra pedir pro Mercado Livre numa chamada só por
// faixa, em vez de uma chamada por dia individual.
function agruparEmFaixas(dias: string[]): { inicio: string; fim: string }[] {
  if (dias.length === 0) return [];
  const ordenados = [...dias].sort();
  const faixas: { inicio: string; fim: string }[] = [];
  let inicioFaixa = ordenados[0];
  let anterior = ordenados[0];
  for (let i = 1; i < ordenados.length; i++) {
    const atual = ordenados[i];
    const diasEntre = (new Date(atual).getTime() - new Date(anterior).getTime()) / (24 * 60 * 60 * 1000);
    if (diasEntre > 1) {
      faixas.push({ inicio: inicioFaixa, fim: anterior });
      inicioFaixa = atual;
    }
    anterior = atual;
  }
  faixas.push({ inicio: inicioFaixa, fim: anterior });
  return faixas;
}

// Soma o gasto de Ads dia a dia: pros dias que já têm foto guardada (ver
// capturarGastoAdsDoDia), usa a foto — imune a campanha excluída. Pros dias
// sem foto (datas anteriores a esse recurso existir, ou hoje antes da
// primeira captura do dia), busca ao vivo só a faixa que falta, e soma os
// dois. Assim um período que mistura dias com e sem foto fecha certo, sem
// silenciosamente ignorar os dias sem foto.
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
  const lojaIds = lojas.map((l) => l.id);

  const hoje = janelaHoje().agora.slice(0, 10);
  const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dataInicioReal = dataInicio ?? seteDiasAtras;
  const dataFimReal = dataFim ?? hoje;

  const [{ rows: somaRows }, { rows: diasRows }] = await Promise.all([
    pool.query<{ soma: string | null }>(
      `SELECT SUM(custo) AS soma FROM ads_gasto_diario WHERE loja_id = ANY($1) AND data BETWEEN $2 AND $3`,
      [lojaIds, dataInicioReal, dataFimReal]
    ),
    pool.query<{ loja_id: number; data: string }>(
      `SELECT DISTINCT loja_id, data::text AS data FROM ads_gasto_diario WHERE loja_id = ANY($1) AND data BETWEEN $2 AND $3`,
      [lojaIds, dataInicioReal, dataFimReal]
    ),
  ]);

  let total = Number(somaRows[0]?.soma ?? 0);

  const diasCapturadosPorLoja = new Map<number, Set<string>>();
  for (const r of diasRows) {
    if (!diasCapturadosPorLoja.has(r.loja_id)) diasCapturadosPorLoja.set(r.loja_id, new Set());
    diasCapturadosPorLoja.get(r.loja_id)!.add(r.data);
  }

  const todosOsDias = listarDiasEntre(dataInicioReal, dataFimReal);

  for (const loja of lojas) {
    const capturados = diasCapturadosPorLoja.get(loja.id) ?? new Set<string>();
    const faltando = todosOsDias.filter((d) => !capturados.has(d));
    const faixas = agruparEmFaixas(faltando);
    if (faixas.length === 0) continue;

    const advertiserId = await getAdvertiserId(loja.id);
    if (advertiserId === null) continue;

    for (const faixa of faixas) {
      try {
        const campanhas = await getCampanhasAds(loja.id, advertiserId, faixa.inicio, faixa.fim);
        total += campanhas.reduce((soma, c) => soma + c.metrics.cost, 0);
      } catch {
        // melhor esforço: se essa faixa falhar, só não soma ela
      }
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
