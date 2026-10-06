import { pool } from "../db/pool";
import { listLojas } from "./tokenStore";
import { listarCampanhasAds, obterGastoAdsHistoricoPorLoja } from "./adsService";
import { listarVendasFinanceiras } from "./financeiroService";
import { dataISOBR } from "./dateUtils";
import { getAdvertiserId, getAnunciosAds, MlAnuncioAds } from "./mercadoLivreApi";

// As 4 lojas do dono (mesmos ids de agendaService.ts). Este painel é pessoal:
// mostra só essas, mesmo que existam outras lojas ML cadastradas.
export const LOJAS_DO_DONO = [1, 2, 3, 4];

// Classificação pela MARGEM PÓS ADS: (margem de contribuição − gasto com Ads)
// ÷ faturamento. Padrão quando a loja não tem meta própria: motor a partir de
// 10%, atenção de 0% a 10%, sangria abaixo de 0%.
export const MARGEM_MOTOR_PADRAO = 10;
export const MARGEM_ATENCAO_PADRAO = 0;

// Campanha que gastou menos que isso é ruído (teste, lance mínimo) e fica
// fora da lista de campanhas.
const GASTO_MINIMO_LISTA = 5;

// Mesma janela de cache das outras telas de Ads (ver adsService.ts).
const CACHE_ANUNCIOS_MS = 15 * 60 * 1000;

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
  // ROAS exato da loja: receita que o ML atribui às campanhas ÷ gasto das
  // campanhas (mesma base dos dois números, ambos da API de anúncios).
  receitaAtribuida: number;
  gastoAtribuido: number;
  // Gasto de anúncios que não gerou nenhuma venda atribuída.
  gastoSemVenda: number;
  // Vendas do período sem custo de produto cadastrado. Enquanto houver
  // alguma, a margem da loja fica em branco em vez de sair inflada.
  vendasSemCusto: number;
  // SKUs dessas vendas que não têm custo na planilha SKU MASTER (ou o SKU
  // nem veio no pedido). É a lista a corrigir pra margem fechar.
  skusSemCusto: string[];
  // Margem de contribuição − gasto total com Ads (inclui campanhas já
  // excluídas, pelo retrato salvo). Null se faltar custo em alguma venda.
  lucroAposAds: number | null;
  // ROAS mínimo pra não dar prejuízo, a partir da margem bruta da loja.
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
  // Receita que o ML atribui à campanha (diretas + indiretas).
  receita: number;
  roas: number | null;
  // Margem pós Ads da campanha, calculada item a item: cada anúncio usa a
  // margem de contribuição % dos seus pedidos no período. Null se algum item
  // não tem custo cadastrado.
  lucroAposAds: number | null;
  margemPosAds: number | null;
  itensSemCusto: number;
  nivel: NivelAds;
}

export interface PainelAds {
  inicio: string;
  fim: string;
  anterior: { inicio: string; fim: string };
  contas: ContaAds[];
  campanhas: CampanhaRanking[];
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

function roasDe(receita: number, gasto: number): number | null {
  return gasto > 0 ? arred2(receita / gasto) : null;
}

function nivelDaMargem(gasto: number, receita: number, margem: number | null, meta: MetaLoja): NivelAds {
  if (gasto === 0 && receita === 0) return "sem_dados";
  // Gastou e não vendeu nada: não tem margem pra calcular, mas é sangria certa.
  if (receita === 0) return "sangria";
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

// Anúncios de cada loja no período, já com custo e receita por item e campanha
// (API de anúncios do ML, a mesma que alimenta Gestão de Ads). Não engole erro:
// se uma loja falhar, o painel mostra o erro em vez de números faltando.
const cacheAnuncios = new Map<string, { data: MlAnuncioAds[]; expiraEm: number }>();
async function anunciosDaLoja(lojaId: number, inicio: string, fim: string): Promise<MlAnuncioAds[]> {
  const chave = `${lojaId}|${inicio}|${fim}`;
  const emCache = cacheAnuncios.get(chave);
  if (emCache && emCache.expiraEm > Date.now()) return emCache.data;
  const advertiserId = await getAdvertiserId(lojaId);
  const data = advertiserId === null ? [] : await getAnunciosAds(lojaId, advertiserId, inicio, fim);
  cacheAnuncios.set(chave, { data, expiraEm: Date.now() + CACHE_ANUNCIOS_MS });
  return data;
}

// Gasto por dia e loja do retrato salvo (ads_gasto_diario). Serve só pro
// gráfico diário — os totais vêm da API ao vivo (ver obterGastoAdsHistoricoPorLoja).
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
  campanhas: CampanhaRanking[];
}

async function calcularPeriodo(
  inicio: string,
  fim: string,
  lojas: LojaPainel[],
  metas: Map<number, MetaLoja>
): Promise<PeriodoCalculado> {
  const ids = lojas.map((l) => l.id);
  const [gastoPorLoja, resultado, nomesCampanhas, snapshot, anunciosPorLoja] = await Promise.all([
    obterGastoAdsHistoricoPorLoja(undefined, ids, inicio, fim),
    listarVendasFinanceiras(undefined, ids, inicio, fim),
    listarCampanhasAds(undefined, ids, inicio, fim),
    gastoDiarioSnapshot(ids, inicio, fim),
    Promise.all(lojas.map(async (l) => [l.id, await anunciosDaLoja(l.id, inicio, fim)] as const)),
  ]);
  const anuncios = new Map<number, MlAnuncioAds[]>(anunciosPorLoja);
  const nomePorCampanha = new Map(nomesCampanhas.map((c) => [`${c.lojaId}|${c.campanhaId}`, c]));

  // Margem de contribuição % de cada anúncio = margem ÷ receita dos pedidos
  // desse item no período. Se algum pedido do item não tem custo, a margem
  // do item fica null (e a campanha que o contém fica sem margem).
  const acumuladoItem = new Map<string, { receita: number; margem: number | null }>();
  for (const v of resultado.vendas) {
    const chave = `${v.lojaId}|${v.itemId}`;
    const e = acumuladoItem.get(chave) ?? { receita: 0, margem: 0 };
    e.receita += v.receitaTotal;
    e.margem = e.margem === null || v.margemContribuicao === null ? null : e.margem + v.margemContribuicao;
    acumuladoItem.set(chave, e);
  }
  const fracaoMargemDoItem = (lojaId: number, itemId: string): number | null => {
    const e = acumuladoItem.get(`${lojaId}|${itemId}`);
    return e && e.margem !== null && e.receita > 0 ? e.margem / e.receita : null;
  };

  const dias = diasEntre(inicio, fim);
  const contas: ContaAds[] = [];
  const campanhas: CampanhaRanking[] = [];

  for (const loja of lojas) {
    const meta = metaOuPadrao(metas, loja.id);
    const vendas = resultado.vendas.filter((v) => v.lojaId === loja.id);
    const faturamento = vendas.reduce((s, v) => s + v.receitaTotal, 0);
    const vendasSemCusto = vendas.filter((v) => v.margemContribuicao === null).length;
    const margemTotal = vendasSemCusto === 0 ? vendas.reduce((s, v) => s + (v.margemContribuicao ?? 0), 0) : null;
    const gasto = gastoPorLoja.get(loja.id) ?? 0;
    const lucroAposAds = margemTotal === null ? null : arred2(margemTotal - gasto);
    const margemPosAds = lucroAposAds === null || faturamento <= 0 ? null : arred1((lucroAposAds / faturamento) * 100);
    const roasEquilibrio =
      margemTotal !== null && faturamento > 0 && margemTotal > 0 ? arred2(faturamento / margemTotal) : null;

    // ROAS atribuído: só campanhas vivas, porque o ML não devolve receita de
    // campanha excluída. Gasto de excluída fica só no total acima.
    let receitaAtribuida = 0;
    let gastoAtribuido = 0;
    let gastoSemVenda = 0;
    for (const a of anuncios.get(loja.id) ?? []) {
      receitaAtribuida += a.metrics.total_amount;
      gastoAtribuido += a.metrics.cost;
      if (a.metrics.total_amount === 0) gastoSemVenda += a.metrics.cost;
    }

    // Lucro por campanha: soma, item a item, receita × margem% − custo do anúncio.
    const porCampanha = new Map<number, { gasto: number; receita: number; lucro: number; semCusto: number }>();
    for (const a of anuncios.get(loja.id) ?? []) {
      const c = porCampanha.get(a.campaign_id) ?? { gasto: 0, receita: 0, lucro: 0, semCusto: 0 };
      const receita = a.metrics.total_amount;
      const custo = a.metrics.cost;
      c.gasto += custo;
      c.receita += receita;
      if (receita === 0) {
        c.lucro -= custo;
      } else {
        const fracao = fracaoMargemDoItem(loja.id, a.item_id);
        if (fracao === null) c.semCusto += 1;
        else c.lucro += receita * fracao - custo;
      }
      porCampanha.set(a.campaign_id, c);
    }
    for (const [campanhaId, c] of porCampanha) {
      if (c.gasto < GASTO_MINIMO_LISTA) continue;
      const lucro = c.semCusto > 0 ? null : arred2(c.lucro);
      const nome = nomePorCampanha.get(`${loja.id}|${campanhaId}`);
      campanhas.push({
        lojaId: loja.id,
        lojaNome: loja.nome,
        campanhaId,
        nome: nome?.nome ?? `Campanha ${campanhaId}`,
        status: nome?.status ?? "desconhecido",
        gasto: arred2(c.gasto),
        receita: arred2(c.receita),
        roas: roasDe(c.receita, c.gasto),
        lucroAposAds: lucro,
        margemPosAds: lucro === null || c.receita <= 0 ? null : arred1((lucro / c.receita) * 100),
        itensSemCusto: c.semCusto,
        nivel: nivelDaMargem(c.gasto, c.receita, lucro === null || c.receita <= 0 ? null : (lucro / c.receita) * 100, meta),
      });
    }

    const faturamentoPorDia = new Map<string, number>();
    for (const v of vendas) {
      const dia = dataISOBR(new Date(v.dataCriacao));
      faturamentoPorDia.set(dia, (faturamentoPorDia.get(dia) ?? 0) + v.receitaTotal);
    }

    contas.push({
      lojaId: loja.id,
      lojaNome: loja.nome,
      gasto: arred2(gasto),
      faturamento: arred2(faturamento),
      roas: roasDe(receitaAtribuida, gastoAtribuido),
      margemPosAds,
      nivel: nivelDaMargem(gasto, faturamento, margemPosAds, meta),
      meta,
      metaPadrao: !metas.has(loja.id),
      receitaAtribuida: arred2(receitaAtribuida),
      gastoAtribuido: arred2(gastoAtribuido),
      gastoSemVenda: arred2(gastoSemVenda),
      vendasSemCusto,
      skusSemCusto: [
        ...new Set(vendas.filter((v) => v.margemContribuicao === null).map((v) => v.sku ?? `item ${v.itemId}`)),
      ].slice(0, 30),
      lucroAposAds,
      roasEquilibrio,
      anterior: { gasto: 0, faturamento: 0, roas: null, margemPosAds: null },
      diario: dias.map((d) => ({
        data: d,
        gasto: arred2(snapshot.get(`${loja.id}|${d}`) ?? 0),
        faturamento: arred2(faturamentoPorDia.get(d) ?? 0),
      })),
    });
  }

  return { contas, campanhas };
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

  return {
    inicio,
    fim,
    anterior: { inicio: anteriorInicio, fim: anteriorFim },
    contas,
    campanhas: atual.campanhas,
  };
}
