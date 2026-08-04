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

export interface CustoFixoLinhaDre {
  descricao: string;
  porMes: number[]; // 12 posições, índice 0 = janeiro
  total: number;
}

export interface Dre {
  ano: number;
  meses: DreMes[];
  totais: DreMes;
  custoFixoDetalhado: CustoFixoLinhaDre[];
}
