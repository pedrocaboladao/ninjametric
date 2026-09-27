export interface TarefaAgenda {
  id: number;
  titulo: string;
  descricao: string | null;
  intervaloDias: number;
  dataInicio: string;
  atribuidoAUsuarioId: number | null;
  atribuidoANome: string | null;
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

export interface NovaTarefaAgenda {
  titulo: string;
  descricao?: string | null;
  intervaloDias: number;
  dataInicio: string;
  atribuidoAUsuarioId?: number | null;
}
