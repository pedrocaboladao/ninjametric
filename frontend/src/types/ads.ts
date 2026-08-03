export interface CampanhaAds {
  lojaId: number;
  lojaNome: string;
  campanhaId: number;
  nome: string;
  status: string;
  orcamento: number;
  acosMeta: number;
  cliques: number;
  impressoes: number;
  custo: number;
  cpc: number;
  vendasDiretas: number;
  vendasIndiretas: number;
  vendasTotais: number;
  acos: number;
}

export interface TacosProduto {
  lojaId: number;
  lojaNome: string;
  itemId: string;
  titulo: string;
  gastoAds: number;
  vendasAtribuidasAds: number;
  receitaTotalReal: number;
  acos: number | null;
  tacos: number | null;
}
