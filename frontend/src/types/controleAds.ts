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
  gastoSemVenda: number;
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
  faturamento: number;
  roas: number | null;
  lucroEstimado: number | null;
  saldo: number;
  nivel: NivelControleAds;
}

export interface PainelControleAds {
  inicio: string;
  fim: string;
  anterior: { inicio: string; fim: string };
  metaPadrao: MetaControleAds;
  contas: ContaControleAds[];
  atencao: CampanhaControleAds[];
  motores: CampanhaControleAds[];
}
