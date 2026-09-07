export interface Cartao {
  id: number;
  colunaId: number;
  titulo: string;
  descricao: string | null;
  concluido: boolean;
  ordem: number;
  compartilhadoComUsuarioId: number | null;
  compartilhadoComNome: string | null;
  criadoPorNome: string | null;
}

export interface UsuarioParaCompartilhar {
  id: number;
  nome: string;
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
