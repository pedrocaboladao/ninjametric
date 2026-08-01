export interface VendaFinanceira {
  orderId: number;
  dataCriacao: string;
  lojaId: number;
  lojaNome: string;
  titulo: string;
  sku: string | null;
  quantidade: number;
  receitaTotal: number;
  custoTotal: number | null;
  taxaMlTotal: number;
  margemContribuicao: number | null;
  margemPercentual: number | null;
}
