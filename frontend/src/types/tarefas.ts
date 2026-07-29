export interface Cartao {
  id: number;
  colunaId: number;
  titulo: string;
  concluido: boolean;
  ordem: number;
}

export interface Coluna {
  id: number;
  nome: string;
  especial: string | null;
  cor: string | null;
  ordem: number;
  cartoes: Cartao[];
}

export interface CartaoArquivado extends Cartao {
  colunaNomeOriginal: string;
}
