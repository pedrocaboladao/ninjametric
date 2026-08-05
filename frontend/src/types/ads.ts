export interface CampanhaAds {
  lojaId: number;
  lojaNome: string;
  campanhaId: number;
  nome: string;
  status: string;
  orcamento: number;
  acosMeta: number;
  acosMetaAnterior: number | null;
  cliques: number;
  impressoes: number;
  custo: number;
  cpc: number;
  vendasDiretas: number;
  vendasIndiretas: number;
  vendasTotais: number;
  acos: number;
}

export interface ReceitaRealCampanha {
  lojaId: number;
  campanhaId: number;
  receitaTotalReal: number;
  acosIdeal: number | null;
}
