export interface VendaFinanceira {
  orderId: number;
  itemId: string;
  dataCriacao: string;
  lojaId: number;
  lojaNome: string;
  titulo: string;
  sku: string | null;
  valorUnitario: number;
  quantidade: number;
  receitaTotal: number;
  custoTotal: number | null;
  taxaMlTotal: number;
  freteVendedorTotal: number | null;
  freteCompradorTotal: number | null;
  impostoTotal: number;
  margemContribuicao: number | null;
  margemPercentual: number | null;
}

export interface ResumoPedidos {
  totalPedidos: number;
  pedidosAprovados: number;
  pedidosCancelados: number;
}

export interface ResultadoFinanceiro {
  vendas: VendaFinanceira[];
  resumoPedidos: ResumoPedidos;
  gastoAdsTotal: number;
}

export interface PontoEquilibrio {
  margemAposAds: number;
  custoFixoMensal: number;
  diasDecorridos: number;
  diasNoMes: number;
  projecaoFechamento: number;
  percentualAtingido: number | null;
}
