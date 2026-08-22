export interface CampanhaItem {
  itemId: string;
  titulo: string | null;
  precoOriginal: number;
  dealPrice: number;
}

export interface Campanha {
  id: number;
  lojaId: number;
  lojaNome: string;
  promotionId: string;
  nome: string;
  percentualDesconto: number;
  dataInicio: string;
  dataFim: string;
  status: string;
  campanhaAnteriorId: number | null;
  itens: CampanhaItem[];
}

export interface ResultadoItemCampanha {
  itemId: string;
  ok: boolean;
  erro?: string;
  precoOriginal?: number;
  dealPrice?: number;
}

export interface ResultadoCriarCampanha {
  campanhaId: number;
  promotionId: string;
  nome: string;
  itens: ResultadoItemCampanha[];
}

export interface RegistroExistenteEntrada {
  lojaId: number;
  nome: string;
  percentual: number;
  dataFim: string;
  itemIds: string[];
  promotionId?: string;
}

export interface ResultadoRegistroLinha {
  linha: number;
  ok: boolean;
  erro?: string;
  resultado?: ResultadoCriarCampanha;
}

export interface ProgressoDescoberta {
  emAndamento: boolean;
  lojaAtual: string | null;
  itensVerificados: number;
  totalItens: number;
  campanhasEncontradas: number;
  campanhasCompletadas: number;
  itensComErro: number;
  candidatosDescartados: number;
  amostraErro: string | null;
  diagnosticos: string[];
  erro: string | null;
}

export interface Oportunidade {
  id: number;
  lojaId: number;
  lojaNome: string;
  itemId: string;
  titulo: string | null;
  permalink: string | null;
  sku: string | null;
  promotionId: string | null;
  tipo: string;
  nome: string | null;
  precoOriginal: number;
  precoEscolhido: number;
  custoUnitario: number | null;
  taxaMl: number | null;
  freteEstimado: number | null;
  margem: number | null;
  percentualMargem: number | null;
  elegivel: boolean;
  meliPercentual: number | null;
  sellerPercentual: number | null;
  status: string;
  erro: string | null;
  descobertoEm: string;
  decididoEm: string | null;
}

export interface ComparacaoOportunidade {
  encontrada: boolean;
  vendaOrderId: number | null;
  vendaData: string | null;
  precoRealUnitario: number | null;
  taxaMlReal: number | null;
  margemRealUnitaria: number | null;
  percentualMargemReal: number | null;
  precoPrevisto: number;
  margemPrevista: number | null;
  percentualMargemPrevista: number | null;
}

export interface ResultadoAprovacaoLote {
  id: number;
  ok: boolean;
  erro?: string;
}

export interface ProgressoBuscaOportunidades {
  emAndamento: boolean;
  lojaAtual: string | null;
  itensVerificados: number;
  totalItens: number;
  candidatasEncontradas: number;
  itensComErro: number;
  erro: string | null;
}
