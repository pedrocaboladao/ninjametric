export interface LojaRepricing {
  id: number;
  nome: string;
}

export interface ConfigRepricing {
  margemMinimaPercentual: number;
  roboPausado: boolean;
  promocoesAutomaticas: boolean;
  ultimaSincronizacao: string | null;
  ultimoErro: string | null;
}

export interface ItemRepricing {
  itemId: string;
  titulo: string;
  thumbnail: string | null;
  permalink: string | null;
  sku: string | null;
  catalogo: boolean;
  precoAtual: number;
  emPromocao: boolean;
  // winning | competing | sharing_first_place | listed
  catalogoStatus: string | null;
  priceToWin: number | null;
  vencedorPreco: number | null;
  catalogoMotivos: string | null;
  custoUnitario: number | null;
  taxaMl: number | null;
  freteEstimado: number | null;
  margemValor: number | null;
  margemPercentual: number | null;
  precoPiso: number | null;
  // Automatização de preços nativa do Mercado Livre ligada (bloqueia o robô)
  automacaoMl: boolean;
  // null = usa a margem mínima padrão da loja
  margemMinimaPercentual: number | null;
  precoMaximo: number | null;
  roboLigado: boolean;
  ultimaAcao: string | null;
  ultimaAcaoEm: string | null;
  aviso: string | null;
}

export interface EventoHistoricoRepricing {
  id: number;
  itemId: string;
  titulo: string;
  // preco | robo_ligado | robo_desligado | promocao_entrou
  tipo: string;
  // só pra tipo = preco: robo | externo
  origem: string | null;
  precoAnterior: number | null;
  precoNovo: number | null;
  margemPercentual: number | null;
  detalhe: string | null;
  usuarioNome: string | null;
  criadoEm: string;
}

export interface PainelRepricing {
  config: ConfigRepricing;
  sincronizando: boolean;
  itens: ItemRepricing[];
  historico: EventoHistoricoRepricing[];
}

export interface ResultadoEmMassa {
  itemId: string;
  ok: boolean;
  erro: string | null;
}

export type SituacaoPromocao =
  | "participando"
  | "vai_entrar"
  | "fora_da_margem"
  | "sem_custo"
  | "manual"
  | "erro"
  | "rejeitada";

export interface PromocaoRepricing {
  id: number;
  itemId: string;
  titulo: string | null;
  permalink: string | null;
  sku: string | null;
  nome: string | null;
  tipo: string;
  precoOriginal: number;
  precoPromocional: number;
  margemPercentual: number | null;
  margemMinimaPercentual: number;
  situacao: SituacaoPromocao;
  erro: string | null;
}

export interface PainelPromocoes {
  automaticas: boolean;
  roboPausado: boolean;
  busca: {
    emAndamento: boolean;
    lojaAtual: string | null;
    itensVerificados: number;
    totalItens: number;
    candidatasEncontradas: number;
    erro: string | null;
  };
  promocoes: PromocaoRepricing[];
}

export interface ResultadoPromocoes {
  entrou: number;
  falhou: number;
  primeiroErro: string | null;
}
