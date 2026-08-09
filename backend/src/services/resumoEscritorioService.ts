import { listLojas } from "./tokenStore";
import { getVisitasContaHoje } from "./mercadoLivreApi";
import { buscarCampanhasComTacos } from "./agenteAdsService";
import { getDashboardData } from "./dashboardService";
import { dataISOBR } from "./dateUtils";

// Mesmo escopo das 4 lojas pessoais que os agentes usam (ver LOJAS_AGENTE em
// agenteAdsService.ts) — os números das telas de parede do Modo TV são
// sobre as 4 lojas do dono, não o grupo inteiro.
const LOJAS_AGENTE = [1, 2, 3, 4];

export interface ResumoEscritorio {
  vendasHoje: number;
  conversaoMediaHoje: number | null;
  lucroAdsHoje: number | null;
}

// Números reais que alimentam as "telas de parede" sobrepostas no vídeo do
// Modo TV — tudo referente ao dia vigente (hoje).
export async function buscarResumoEscritorio(): Promise<ResumoEscritorio> {
  const hoje = dataISOBR(new Date());
  const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null && LOJAS_AGENTE.includes(l.id));

  const [dashboard, campanhasHoje, visitasPorLoja] = await Promise.all([
    getDashboardData(undefined, LOJAS_AGENTE),
    buscarCampanhasComTacos(1),
    Promise.all(lojas.map((l) => getVisitasContaHoje(l.id, l.ml_user_id as number, hoje, hoje))),
  ]);

  // Conversão média do dia = vendas (unidades) / visitas da conta inteira,
  // agregado nas 4 lojas — usa o total de vendas do ranking do Dashboard
  // (já filtrado pras 4 lojas) em vez de contar pedido por pedido de novo.
  const totalVendas = dashboard.rankingLojas
    .filter((r) => LOJAS_AGENTE.includes(r.lojaId))
    .reduce((soma, r) => soma + r.numVendas, 0);
  const totalVisitas = visitasPorLoja.reduce((soma: number, v) => soma + (v ?? 0), 0);
  const conversaoMediaHoje = totalVisitas > 0 ? (totalVendas / totalVisitas) * 100 : null;

  // Lucro do Ads hoje = soma do lucro real (receita real x teto de margem -
  // custo) das campanhas ativas com gasto hoje — mesmo cálculo que o
  // Analista de Ads já usa (buscarCampanhasComTacos), só somado em vez de
  // por campanha.
  const ativasHoje = campanhasHoje.filter((c) => c.status === "active" && c.custo > 0 && c.lucroReais !== null);
  const lucroAdsHoje = ativasHoje.length > 0 ? ativasHoje.reduce((soma, c) => soma + (c.lucroReais as number), 0) : null;

  return {
    vendasHoje: dashboard.faturamentoHoje,
    conversaoMediaHoje,
    lucroAdsHoje,
  };
}
