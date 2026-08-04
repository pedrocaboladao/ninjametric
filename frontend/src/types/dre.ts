export interface DreMes {
  mes: number;
  faturamento: number;
  freteVendedor: number;
  custoProdutos: number;
  taxaMl: number;
  imposto: number;
  cancelamentos: number;
  margemContribuicao: number;
  margemPercentual: number | null;
  gastoAds: number;
  custoFixoManual: number;
  custoFixoTotal: number;
  lucroLiquido: number;
  lucroPercentual: number | null;
}

export interface Dre {
  ano: number;
  meses: DreMes[];
  totais: DreMes;
}
