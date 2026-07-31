export interface RankingLoja {
  lojaId: number;
  lojaNome: string;
  valor: number;
  numVendas: number;
  numUnidades: number;
  percentualDoTotal: number;
}

export interface VendaPorHora {
  hora: number;
  hoje: number;
  ontem: number;
}

export interface ProdutoMaisVendido {
  sku: string | null;
  mlItemId: string;
  titulo: string;
  lojaId: number;
  lojaNome: string;
  precoTotal: number;
  quantidade: number;
  foto: string | null;
  linkMl: string | null;
}

export interface DashboardData {
  faturamentoHoje: number;
  faturamentoOntemMesmoHorario: number;
  variacaoPercentual: number | null;
  rankingLojas: RankingLoja[];
  vendasPorHora: VendaPorHora[];
  produtosMaisVendidos: ProdutoMaisVendido[];
  ultimaVendaEm: string | null;
}

export type PromocaoStatus = "com_promocao" | "sem_promocao" | "nao_verificado";

export interface TopVendidoPromocao {
  mlItemId: string;
  titulo: string;
  lojaId: number;
  lojaNome: string;
  precoTotal: number;
  quantidade: number;
  foto: string | null;
  linkMl: string | null;
  promocao: PromocaoStatus;
}
