export interface VendaFinanceiraShopee {
  orderSn: string;
  itemId: number;
  dataCriacao: string;
  lojaId: number;
  lojaNome: string;
  titulo: string;
  sku: string | null;
  valorUnitario: number;
  quantidade: number;
  receitaTotal: number;
  custoTotal: number | null;
  impostoTotal: number;
  taxaShopeeTotal: number;
  comissaoAfiliadoTotal: number;
  comissaoAfiliadoEstimada: boolean;
  cupomVendedorTotal: number;
  freteVendedorTotal: number;
  outrasTaxasTotal: number;
  margemContribuicao: number | null;
  margemPercentual: number | null;
  itemBrinde: boolean;
}

export interface ResumoPedidosShopee {
  totalPedidos: number;
  pedidosAprovados: number;
  pedidosCancelados: number;
  valorCancelado: number;
}

export interface ResultadoFinanceiroShopee {
  vendas: VendaFinanceiraShopee[];
  resumoPedidos: ResumoPedidosShopee;
  gastoAdsTotal: number;
  pedidosSemTaxa: number;
  pedidosReembolsados: number;
  pedidosNaoConciliados: number;
}
