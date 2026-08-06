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
