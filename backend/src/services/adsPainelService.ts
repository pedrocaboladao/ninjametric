import { pool } from "../db/pool";
import { listLojas } from "./tokenStore";
import { listarCampanhasAds, CampanhaAds } from "./adsService";
import { obterGastoAdsHistoricoPorLoja } from "./adsService";
import { listarVendasFinanceiras } from "./financeiroService";
import { dataISOBR } from "./dateUtils";

// As 4 lojas do dono (mesmos ids de agendaService.ts). Este painel é pessoal:
// mostra só essas, mesmo que existam outras lojas ML cadastradas.
export const LOJAS_DO_DONO = [1, 2, 3, 4];

// Classificação pela MARGEM PÓS ADS (lucro depois de custo, taxa, frete e
// gasto com Ads, em % do faturamento). Padrão quando a loja não tem meta
// própria: margem de pelo menos 10% = motor, entre 0% e 10% = atenção, abaixo
// de 0% = sangria (o anúncio está dando prejuízo).
export const MARGEM_MOTOR_PADRAO = 10;
export const MARGEM_ATENCAO_PADRAO = 0;

// Campanha que gastou menos que isso é ruído (teste, lance mínimo) e fica
// fora das listas ATENÇÃO e MOTORES.
const GASTO_MINIMO_LISTA = 5;
const ITENS_POR_LISTA = 5;

export type NivelAds = "motor" | "atencao" | "sangria" | "sem_dados";

export interface MetaLoja {
  motorMinimo: number;
  atencaoMinimo: number;
}

export interface DiaAds {
  data: string;
  gasto: number;
  faturamento: number;
}

interface Indicadores {
  gasto: number;
  faturamento: number;
  roas: number | null;
  margemPosAds: number | null;
}

export interface ContaAds extends Indicadores {
  lojaId: number;
  lojaNome: string;
  nivel: NivelAds;
  meta: MetaLoja;
  metaPadrao: boolean;
  gastoSemVenda: number;
  // Margem de contribuição (já descontado custo, taxa e frete) menos o gasto
  // de Ads. Null quando alguma venda do período não tem custo cadastrado.
  lucroAposAds: number | null;
  // ROAS de equilíbrio: a partir de quanto a campanha paga o próprio custo do
  // produto, taxa e frete. Abaixo disso, cada real em Ads dá prejuízo.
  roasEquilibrio: number | null;
  anterior: Indicadores;
  diario: DiaAds[];
}

export interface CampanhaRanking {
  lojaId: number;
  lojaNome: string;
  campanhaId: number;
  nome: string;
  status: string;
  gasto: number;
  // Receita atribuída pelo ML à campanha (vendas diretas + indiretas).
  faturamento: number;
  roas: number | null;
  // Receita da campanha × margem bruta média da loja, menos o gasto. É uma
  // estimativa: a campanha não tem custo de produto próprio, então usa a média.
  lucroEstimado: number | null;
  // Sobra de caixa simples: receita menos gasto (sem custo de produto).
  saldo: number;
  nivel: NivelAds;
}

export interface PainelAds {
  inicio: string;
  fim: string;
  anterior: { inicio: string; fim: string };
  contas: ContaAds[];
  atencao: CampanhaRanking[];
  motores: CampanhaRanking[];
}

interface LojaPainel {
  id: number;
  nome: string;
}

function addDias(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function diasEntre(inicio: string, fim: string): string[] {
  const dias: string[] = [];
  for (let d = inicio; d <= fim; d = addDias(d, 1)) dias.push(d);
  return dias;
}

const arred1 = (n: number) => Math.round(n * 10) / 10;
const arred2 = (n: number) => Math.round(n * 100) / 100;

function roasDe(gasto: number, faturamento: number): number | null {
  return gasto > 0 ? arred2(faturamento / gasto) : null;
}

function margemPosAdsDe(faturamento: number, lucroAposAds: number | null): number | null {
  if (lucroAposAds === null || faturamento <= 0) return null;
  return arred1((lucroAposAds / faturamento) * 100);
}

function nivelDaMargem(gasto: number, faturamento: number, margem: number | null, meta: MetaLoja): NivelAds {
  if (gasto === 0 && faturamento === 0) return "sem_dados";
  // Gastou e não vendeu nada: não tem margem pra calcular, mas é sangria certa.
  if (faturamento === 0) return "sangria";
  if (margem === null) return "sem_dados";
  if (margem >= meta.motorMinimo) return "motor";
  if (margem >= meta.atencaoMinimo) return "atencao";
  return "sangria";
}

function metaOuPadrao(metas: Map<number, MetaLoja>, lojaId: number): MetaLoja {
  return metas.get(lojaId) ?? { motorMinimo: MARGEM_MOTOR_PADRAO, atencaoMinimo: MARGEM_ATENCAO_PADRAO };
}

export async function listarMetas(): Promise<Map<number, MetaLoja>> {
  const { rows } = await pool.query<{ loja_id: number; motor_minimo: string; atencao_minimo: string }>(
    "SELECT loja_id, motor_minimo, atencao_minimo FROM controle_ads_metas"
  );
  return new Map(
    rows.map((r) => [r.loja_id, { motorMinimo: Number(r.motor_minimo), atencaoMinimo: Number(r.atencao_minimo) }])
  );
}

export async function salvarMeta(lojaId: number, motorMinimo: number, atencaoMinimo: number): Promise<void> {
  if (!LOJAS_DO_DONO.includes(lojaId)) throw new Error("Esta loja não faz parte do painel.");
  if (!(motorMinimo > atencaoMinimo && motorMinimo <= 100 && atencaoMinimo >= -100)) {
    throw new Error("A margem mínima de motor precisa ser maior que a de atenção (que pode ser negativa), e no máximo 100%.");
  }
  await pool.query(
    `INSERT INTO controle_ads_metas (loja_id, motor_minimo, atencao_minimo, atualizado_em)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (loja_id) DO UPDATE SET motor_minimo = $2, atencao_minimo = $3, atualizado_em = now()`,
    [lojaId, motorMinimo, atencaoMinimo]
  );
}

// Gasto por dia e loja do retrato salvo (ads_gasto_diario). Serve só pro
// gráfico diário — o total do período continua vindo da API ao vivo, que é a
// fonte de verdade (ver obterGastoAdsHistoricoPorLoja).
async function gastoDiarioSnapshot(lojaIds: number[], inicio: string, fim: string): Promise<Map<string, number>> {
  const { rows } = await pool.query<{ loja_id: number; data: string; gasto: string }>(
    `SELECT loja_id, to_char(data, 'YYYY-MM-DD') AS data, SUM(custo) AS gasto
     FROM ads_gasto_diario
     WHERE loja_id = ANY($1) AND data BETWEEN $2 AND $3
     GROUP BY loja_id, data`,
    [lojaIds, inicio, fim]
  );
  return new Map(rows.map((r) => [`${r.loja_id}|${r.data}`, Number(r.gasto)]));
}

interface PeriodoCalculado {
  contas: ContaAds[];
  campanhas: CampanhaAds[];
  margemBrutaPorLoja: Map<number, number | null>;
}

async function calcularPeriodo(
  inicio: string,
  fim: string,
  lojas: LojaPainel[],
  metas: Map<number, MetaLoja>
): Promise<PeriodoCalculado> {
  const ids = lojas.map((l) => l.id);
  const [gastoPorLoja, resultado, campanhas, snapshot] = await Promise.all([
    obterGastoAdsHistoricoPorLoja(undefined, ids, inicio, fim),
    listarVendasFinanceiras(undefined, ids, inicio, fim),
    listarCampanhasAds(undefined, ids, inicio, fim),
    gastoDiarioSnapshot(ids, inicio, fim),
  ]);

  const dias = diasEntre(inicio, fim);
  const margemBrutaPorLoja = new Map<number, number | null>();
  const contas = lojas.map((loja): ContaAds => {
    const meta = metaOuPadrao(metas, loja.id);
    const vendas = resultado.vendas.filter((v) => v.lojaId === loja.id);
    const faturamento = vendas.reduce((s, v) => s + v.receitaTotal, 0);
    const margem = vendas.reduce<number | null>(
      (s, v) => (s === null || v.margemContribuicao === null ? null : s + v.margemContribuicao),
      0
    );
    const gasto = gastoPorLoja.get(loja.id) ?? 0;
    const lucroAposAds = margem === null ? null : arred2(margem - gasto);
    margemBrutaPorLoja.set(loja.id, margem === null || faturamento <= 0 ? null : margem / faturamento);

    const gastoSemVenda = campanhas
      .filter((c) => c.lojaId === loja.id && c.vendasTotais === 0)
      .reduce((s, c) => s + c.custo, 0);

    const faturamentoPorDia = new Map<string, number>();
    for (const v of vendas) {
      const dia = dataISOBR(new Date(v.dataCriacao));
      faturamentoPorDia.set(dia, (faturamentoPorDia.get(dia) ?? 0) + v.receitaTotal);
    }

    const margemPosAds = margemPosAdsDe(faturamento, lucroAposAds);
    const bruta = margemBrutaPorLoja.get(loja.id) ?? null;
    return {
      lojaId: loja.id,
      lojaNome: loja.nome,
      gasto: arred2(gasto),
      faturamento: arred2(faturamento),
      roas: roasDe(gasto, faturamento),
      margemPosAds,
      nivel: nivelDaMargem(gasto, faturamento, margemPosAds, meta),
      meta,
      metaPadrao: !metas.has(loja.id),
      gastoSemVenda: arred2(gastoSemVenda),
      lucroAposAds,
      roasEquilibrio: bruta !== null && bruta > 0 ? arred2(1 / bruta) : null,
      anterior: { gasto: 0, faturamento: 0, roas: null, margemPosAds: null },
      diario: dias.map((d) => ({
        data: d,
        gasto: arred2(snapshot.get(`${loja.id}|${d}`) ?? 0),
        faturamento: arred2(faturamentoPorDia.get(d) ?? 0),
      })),
    };
  });

  return { contas, campanhas, margemBrutaPorLoja };
}

function rankingDe(campanhas: CampanhaAds[], margemBrutaPorLoja: Map<number, number | null>): CampanhaRanking[] {
  return campanhas
    .filter((c) => c.custo >= GASTO_MINIMO_LISTA)
    .map((c): CampanhaRanking => {
      const faturamento = c.vendasTotais;
      const bruta = margemBrutaPorLoja.get(c.lojaId) ?? null;
      const roas = roasDe(c.custo, faturamento);
      const equilibrio = bruta !== null && bruta > 0 ? 1 / bruta : null;
      const lucroEstimado = bruta === null ? null : arred2(faturamento * bruta - c.custo);
      // Sem venda, ou ROAS abaixo do equilíbrio da loja, a campanha está dando prejuízo.
      const sangrando = faturamento === 0 || (roas !== null && equilibrio !== null && roas < equilibrio);
      return {
        lojaId: c.lojaId,
        lojaNome: c.lojaNome,
        campanhaId: c.campanhaId,
        nome: c.nome,
        status: c.status,
        gasto: arred2(c.custo),
        faturamento: arred2(faturamento),
        roas,
        lucroEstimado,
        saldo: arred2(faturamento - c.custo),
        nivel: sangrando ? "sangria" : "motor",
      };
    });
}

export async function obterPainelAds(inicio: string, fim: string): Promise<PainelAds> {
  const lojas: LojaPainel[] = (await listLojas())
    .filter((l) => l.ml_user_id !== null && LOJAS_DO_DONO.includes(l.id))
    .map((l) => ({ id: l.id, nome: l.nome }));
  const metas = await listarMetas();

  // Período anterior de mesmo tamanho, logo antes do atual. Serve pras setas
  // de comparação nos cards ("a margem melhorou ou piorou?").
  const n = diasEntre(inicio, fim).length;
  const anteriorInicio = addDias(inicio, -n);
  const anteriorFim = addDias(inicio, -1);

  const atual = await calcularPeriodo(inicio, fim, lojas, metas);
  const anterior = await calcularPeriodo(anteriorInicio, anteriorFim, lojas, metas);

  const contas = atual.contas.map((conta): ContaAds => {
    const ant = anterior.contas.find((c) => c.lojaId === conta.lojaId);
    return {
      ...conta,
      anterior: ant
        ? { gasto: ant.gasto, faturamento: ant.faturamento, roas: ant.roas, margemPosAds: ant.margemPosAds }
        : { gasto: 0, faturamento: 0, roas: null, margemPosAds: null },
    };
  });

  const ordem: Record<NivelAds, number> = { sangria: 0, atencao: 1, motor: 2, sem_dados: 3 };
  contas.sort((a, b) => ordem[a.nivel] - ordem[b.nivel] || b.gasto - a.gasto);

  const ranking = rankingDe(atual.campanhas, atual.margemBrutaPorLoja);
  // Ordena pelo lucro estimado quando existe; sem custo cadastrado, usa a sobra simples.
  const chave = (c: CampanhaRanking) => c.lucroEstimado ?? c.saldo;
  const atencao = ranking
    .filter((c) => c.nivel === "sangria")
    .sort((a, b) => chave(a) - chave(b))
    .slice(0, ITENS_POR_LISTA);
  const motores = ranking
    .filter((c) => c.nivel === "motor" && chave(c) > 0)
    .sort((a, b) => chave(b) - chave(a))
    .slice(0, ITENS_POR_LISTA);

  return {
    inicio,
    fim,
    anterior: { inicio: anteriorInicio, fim: anteriorFim },
    contas,
    atencao,
    motores,
  };
}
