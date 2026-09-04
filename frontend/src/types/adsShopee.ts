export interface CampanhaAdsShopee {
  lojaId: number;
  lojaNome: string;
  campanhaId: number;
  nome: string;
  status: string;
  tipoAnuncio: string;
  orcamento: number;
  // null quando a campanha usa lance manual — a Shopee não devolve meta de
  // ROAS nesse caso.
  acosMeta: number | null;
  cliques: number;
  impressoes: number;
  custo: number;
  cpc: number;
  vendasDiretas: number;
  vendasIndiretas: number;
  vendasTotais: number;
  acos: number;
  tacosReal: number | null;
  acosIdeal: number | null;
  lucroReais: number | null;
}
