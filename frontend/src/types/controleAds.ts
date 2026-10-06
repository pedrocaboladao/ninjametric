export type NivelControleAds = "motor" | "atencao" | "sangria" | "sem_dados";

export interface ContaControleAds {
  lojaId: number;
  lojaNome: string;
  gasto: number;
  faturamento: number;
  acos: number | null;
  nivel: NivelControleAds;
}

export interface PainelControleAds {
  inicio: string;
  fim: string;
  limites: { motorAte: number; atencaoAte: number };
  contas: ContaControleAds[];
}
