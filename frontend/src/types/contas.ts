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
  contatoId: number | null;
  contatoNome: string | null;
  grupoParcelamentoId: number | null;
  parcelaNumero: number | null;
  parcelaTotal: number | null;
  grupoRateioId: number | null;
  rateioTotal: number | null;
}

export type TipoContato = "fornecedor" | "cliente";

export interface Contato {
  id: number;
  tipo: TipoContato;
  nome: string;
  documento: string | null;
  dadosBancarios: string | null;
  contato: string | null;
  criadoEm: string;
}

export interface NovoContatoInput {
  tipo: TipoContato;
  nome: string;
  documento?: string | null;
  dadosBancarios?: string | null;
  contato?: string | null;
}

export interface EdicaoContatoInput {
  nome?: string;
  documento?: string | null;
  dadosBancarios?: string | null;
  contato?: string | null;
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
  contatoId?: number | null;
  valor: number;
  vencimento: string;
  observacao?: string | null;
}

export interface NovoLancamentoParceladoInput {
  lojaId: number;
  tipo: TipoLancamento;
  descricao: string;
  categoria?: string | null;
  contatoId?: number | null;
  valorParcela: number;
  primeiroVencimento: string;
  quantidadeParcelas: number;
  observacao?: string | null;
}

export interface NovoLancamentoRateadoInput {
  lojaIds: number[];
  tipo: TipoLancamento;
  descricao: string;
  categoria?: string | null;
  contatoId?: number | null;
  valorTotal: number;
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
