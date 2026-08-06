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
  itensComErro: number;
  candidatosDescartados: number;
  amostraErro: string | null;
  erro: string | null;
}
