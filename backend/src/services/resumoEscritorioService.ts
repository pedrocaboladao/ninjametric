import { listLojas } from "./tokenStore";
import { getVisitasContaHoje } from "./mercadoLivreApi";
import { getDashboardData } from "./dashboardService";
import { listarVendasFinanceiras } from "./financeiroService";
import { dataISOBR } from "./dateUtils";
import { contarAnunciosNegativos } from "./anunciosNegativosService";

// Mesmo escopo das 4 lojas pessoais que os agentes usam (ver LOJAS_AGENTE em
// agenteAdsService.ts) — os números das telas de parede do Modo TV são
// sobre as 4 lojas do dono, não o grupo inteiro.
const LOJAS_AGENTE = [1, 2, 3, 4];

export interface ResumoEscritorio {
  vendasHoje: number;
  conversaoMediaHoje: number | null;
  lucroAdsHoje: number | null;
  anunciosNegativos: number;
}

// Números reais que alimentam as "telas de parede" sobrepostas no vídeo do
// Modo TV — tudo referente ao dia vigente (hoje). "forcar" pula o cache de
// 15min do Financeiro (mesmo botão "Atualizar" que a tela de Financeiro já
// tem) — sem isso o Modo TV sempre serve o cache, já que atualiza sozinho a
// cada 60s e forçar uma busca ao vivo nesse ritmo o dia inteiro pesaria
// demais na API do Mercado Livre.
export async function buscarResumoEscritorio(forcar = false): Promise<ResumoEscritorio> {
  const hoje = dataISOBR(new Date());
  const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null && LOJAS_AGENTE.includes(l.id));

  const [dashboard, financeiroHoje, visitasPorLoja, anunciosNegativos] = await Promise.all([
    getDashboardData(undefined, LOJAS_AGENTE),
    listarVendasFinanceiras(undefined, LOJAS_AGENTE, hoje, hoje, forcar),
    Promise.all(lojas.map((l) => getVisitasContaHoje(l.id, l.ml_user_id as number, hoje, hoje))),
    contarAnunciosNegativos(LOJAS_AGENTE),
  ]);

  // Conversão média do dia = vendas (unidades) / visitas da conta inteira,
  // agregado nas 4 lojas — usa o total de vendas do ranking do Dashboard
  // (já filtrado pras 4 lojas) em vez de contar pedido por pedido de novo.
  const totalVendas = dashboard.rankingLojas
    .filter((r) => LOJAS_AGENTE.includes(r.lojaId))
    .reduce((soma, r) => soma + r.numVendas, 0);
  const totalVisitas = visitasPorLoja.reduce((soma: number, v) => soma + (v ?? 0), 0);
  const conversaoMediaHoje = totalVisitas > 0 ? (totalVendas / totalVisitas) * 100 : null;

  // Lucro do Ads hoje = lucro real do dia depois do Ads, mesma conta que o
  // Financeiro usa em "Margem após Ads" (margem de contribuição do dia menos
  // o gasto total de Ads do dia) — não é o lucro-por-campanha do Analista de
  // Ads (esse usa o teto de ACOS de cada anúncio, é outra pergunta).
  // Reaproveita listarVendasFinanceiras direto, só fixando nas 4 lojas e no
  // dia de hoje, pra bater exatamente com o que o Financeiro mostraria com
  // esse mesmo filtro.
  const margemContribuicaoHoje = financeiroHoje.vendas.reduce((soma, v) => soma + (v.margemContribuicao ?? 0), 0);
  const lucroAdsHoje = margemContribuicaoHoje - financeiroHoje.gastoAdsTotal;

  return {
    vendasHoje: dashboard.faturamentoHoje,
    conversaoMediaHoje,
    lucroAdsHoje,
    anunciosNegativos,
  };
}
