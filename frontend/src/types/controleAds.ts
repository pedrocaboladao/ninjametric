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

export interface PainelControleAds {
  inicio: string;
  fim: string;
  anterior: { inicio: string; fim: string };
  metaPadrao: MetaControleAds;
  contas: ContaControleAds[];
  campanhas: CampanhaControleAds[];
}
