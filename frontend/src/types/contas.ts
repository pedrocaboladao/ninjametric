export type TipoLancamento = "pagar" | "receber";
export type StatusLancamento = "pendente" | "pago" | "cancelado";

export interface Lancamento {
  id: number;
  lojaId: number;
  lojaNome: string;
  tipo: TipoLancamento;
  descricao: string;
  categoria: string | null;
  valor: number;
  vencimento: string;
  status: StatusLancamento;
  dataPagamento: string | null;
  observacao: string | null;
  criadoPorId: number | null;
  criadoPorNome: string | null;
  criadoEm: string;
  atualizadoEm: string;
  atrasado: boolean;
}

export interface ResumoContas {
  emAbertoPagar: number;
  emAbertoReceber: number;
  atrasadoPagar: number;
  atrasadoReceber: number;
  pagoPeriodo: number;
  recebidoPeriodo: number;
  saldoPeriodo: number;
}

export interface NovoLancamentoInput {
  lojaId: number;
  tipo: TipoLancamento;
  descricao: string;
  categoria?: string | null;
  valor: number;
  vencimento: string;
  observacao?: string | null;
}

export interface EdicaoLancamentoInput {
  descricao?: string;
  categoria?: string | null;
  valor?: number;
  vencimento?: string;
  observacao?: string | null;
  status?: StatusLancamento;
  dataPagamento?: string | null;
}
