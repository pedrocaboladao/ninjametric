export type NivelControleAds = "motor" | "atencao" | "sangria" | "sem_dados";

export interface MetaControleAds {
  motorMinimo: number;
  atencaoMinimo: number;
}

export interface DiaControleAds {
  data: string;
  gasto: number;
  faturamento: number;
}

export interface IndicadoresControleAds {
  gasto: number;
  faturamento: number;
  roas: number | null;
  margemPosAds: number | null;
}

export interface ContaControleAds extends IndicadoresControleAds {
  lojaId: number;
  lojaNome: string;
  nivel: NivelControleAds;
  meta: MetaControleAds;
  metaPadrao: boolean;
  receitaAtribuida: number;
  gastoAtribuido: number;
  gastoSemVenda: number;
  vendasSemCusto: number;
  skusSemCusto: string[];
  lucroAposAds: number | null;
  roasEquilibrio: number | null;
  roasEquilibrioAproximado: boolean;
  anterior: IndicadoresControleAds;
  diario: DiaControleAds[];
}

export interface CampanhaControleAds {
  lojaId: number;
  lojaNome: string;
  campanhaId: number;
  nome: string;
  status: string;
  gasto: number;
  receita: number;
  roas: number | null;
  lucroAposAds: number | null;
  margemPosAds: number | null;
  itensSemCusto: number;
  nivel: NivelControleAds;
}

export interface LinhaAcaoCampanha {
  campanha: string;
  loja: string;
  roas: number | null;
  roasMinimo: number | null;
  gasto: number | null;
  resultado: number | null;
  acao: string;
}

export interface LinhaGovernancaAds {
  loja: string;
  vendasSemCusto: number;
  skus: string[];
}

export interface PlanoDeAcaoControleAds {
  pensamento: string | null;
  resumo: string;
  regraDaSemana: string;
  cortar: LinhaAcaoCampanha[];
  escalar: LinhaAcaoCampanha[];
  margem: LinhaAcaoCampanha[];
  governanca: LinhaGovernancaAds[];
}

export interface StatusPlanoControleAds {
  ilimitado: boolean;
  usado: boolean;
  liberaEm: string | null;
  ultimo: { plano: PlanoDeAcaoControleAds; inicio: string; fim: string; lojaId: number | null; geradoEm: string } | null;
}

export interface PainelControleAds {
  inicio: string;
  fim: string;
  anterior: { inicio: string; fim: string };
  metaPadrao: MetaControleAds;
  contas: ContaControleAds[];
  campanhas: CampanhaControleAds[];
}
