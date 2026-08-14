export interface PesquisaCategoria {
  id: number;
  nome: string;
}

export interface PesquisaRankingLinha {
  id: number;
  vendedor: string;
  qtde: number;
  totalReais: number;
  participacaoPercentual: number;
}

export interface PesquisaEvolucaoSerie {
  vendedor: string;
  valores: (number | null)[];
}

export interface PesquisaEvolucao {
  meses: string[];
  totalMercadoPorMes: number[];
  series: PesquisaEvolucaoSerie[];
}

export interface ResumoImportacaoPlanilha {
  categoria: string;
  criada: boolean;
  linhas: number;
  meses: number;
}
