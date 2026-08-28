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
  margemContribuicao: number | null;
  margemPercentual: number | null;
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
}
