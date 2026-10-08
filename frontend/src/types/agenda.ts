export interface TarefaAgenda {
  id: number;
  titulo: string;
  descricao: string | null;
  intervaloDias: number;
  dataInicio: string;
  atribuidoAUsuarioId: number | null;
  atribuidoANome: string | null;
  lojaId: number | null;
  lojaNome: string | null;
  criadoPorUsuarioId: number;
  criadoPorNome: string;
  ativo: boolean;
}

export interface OcorrenciaDia {
  tarefaId: number;
  titulo: string;
  descricao: string | null;
  atribuidoAUsuarioId: number | null;
  atribuidoANome: string | null;
  lojaId: number | null;
  lojaNome: string | null;
  concluido: boolean;
  atrasado: boolean;
}

export interface DiaSemanaAgenda {
  data: string;
  ocorrencias: OcorrenciaDia[];
}

export interface SemanaAgenda {
  hoje: string;
  inicioSemana: string;
  fimSemana: string;
  dias: DiaSemanaAgenda[];
}

export interface UsuarioParaAtribuir {
  id: number;
  nome: string;
}

export interface LojaParaAgenda {
  id: number;
  nome: string;
}

export interface NovaTarefaAgenda {
  titulo: string;
  descricao?: string | null;
  intervaloDias: number;
  dataInicio: string;
  atribuidoAUsuarioId?: number | null;
  lojaId?: number | null;
}

export interface PromocaoDaLoja {
  lojaId: number;
  lojaNome: string;
  promocaoNome: string | null;
  diasRestantes: number | null;
}

export interface RelatorioAgenda {
  id: number;
  sku: string;
  link: string;
  texto: string | null;
  lojaId: number | null;
  lojaNome: string | null;
  usuarioId: number;
  usuarioNome: string;
  criadoEm: string;
}

export interface NovoRelatorioAgenda {
  sku: string;
  link: string;
  texto?: string | null;
  lojaId?: number | null;
}

export interface CardQuadroAgenda {
  id: number;
  titulo: string;
  descricao: string | null;
  atribuidoAUsuarioId: number | null;
  atribuidoANome: string | null;
  lojaId: number | null;
  lojaNome: string | null;
  capaAnexoId: number | null;
  totalAnexos: number;
  concluido: boolean;
}

export interface AnexoCardAgenda {
  id: number;
  nome: string;
  tipo: string;
  tamanho: number;
  capa: boolean;
  criadoEm: string;
}

export interface ColunaQuadroAgenda {
  id: number;
  nome: string;
  cards: CardQuadroAgenda[];
}

export interface DadosCardQuadroAgenda {
  titulo: string;
  descricao?: string | null;
  atribuidoAUsuarioId?: number | null;
  lojaId?: number | null;
  concluido?: boolean;
}

export interface AvisoAgenda {
  id: number;
  texto: string;
  usuarioNome: string;
  criadoEm: string;
  podeExcluir: boolean;
}
