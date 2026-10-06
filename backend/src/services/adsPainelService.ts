import { obterGastoAdsHistoricoPorLoja } from "./adsService";
import { listarVendasFinanceiras } from "./financeiroService";
import { listLojas } from "./tokenStore";

// ACOS = gasto em Ads ÷ faturamento aprovado. Até o primeiro limite a conta
// está "motor" (o anúncio está pagando), até o segundo "atenção", acima disso
// "sangria" (o gasto está comendo a venda).
export const ACOS_MOTOR_ATE = 15;
export const ACOS_ATENCAO_ATE = 25;

export type NivelAds = "motor" | "atencao" | "sangria" | "sem_dados";

export interface ContaAds {
  lojaId: number;
  lojaNome: string;
  gasto: number;
  faturamento: number;
  acos: number | null;
  nivel: NivelAds;
}

function nivelDoAcos(gasto: number, faturamento: number, acos: number | null): NivelAds {
  if (gasto === 0 && faturamento === 0) return "sem_dados";
  if (acos === null) return "sangria";
  if (acos <= ACOS_MOTOR_ATE) return "motor";
  if (acos <= ACOS_ATENCAO_ATE) return "atencao";
  return "sangria";
}

export async function obterPainelAds(inicio: string, fim: string): Promise<ContaAds[]> {
  const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null);
  const [gastoPorLoja, resultado] = await Promise.all([
    obterGastoAdsHistoricoPorLoja(undefined, undefined, inicio, fim),
    listarVendasFinanceiras(undefined, undefined, inicio, fim),
  ]);

  const faturamentoPorLoja = new Map<number, number>();
  for (const v of resultado.vendas) {
    faturamentoPorLoja.set(v.lojaId, (faturamentoPorLoja.get(v.lojaId) ?? 0) + v.receitaTotal);
  }

  return lojas
    .map((loja) => {
      const gasto = gastoPorLoja.get(loja.id) ?? 0;
      const faturamento = faturamentoPorLoja.get(loja.id) ?? 0;
      const acos = faturamento > 0 ? (gasto / faturamento) * 100 : null;
      return {
        lojaId: loja.id,
        lojaNome: loja.nome,
        gasto: Math.round(gasto * 100) / 100,
        faturamento: Math.round(faturamento * 100) / 100,
        acos: acos === null ? null : Math.round(acos * 10) / 10,
        nivel: nivelDoAcos(gasto, faturamento, acos),
      };
    })
    .sort((a, b) => {
      const ordem: Record<NivelAds, number> = { sangria: 0, atencao: 1, motor: 2, sem_dados: 3 };
      return ordem[a.nivel] - ordem[b.nivel] || b.gasto - a.gasto;
    });
}
