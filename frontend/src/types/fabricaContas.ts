// Contas a pagar e receber da Fábrica Distribuidora — o barracão da fabricação,
// que paga aluguel, água e luz próprios.
//
// Separado do Contas a pagar das lojas de propósito: lá todo lançamento exige
// uma loja, e a despesa da fábrica entraria no resultado dela. A loja chamada
// "Fábrica de Tintas" é outra coisa — uma loja que compra da fábrica.
export type TipoConta = "pagar" | "receber";
export type StatusConta = "pendente" | "pago" | "cancelado";

export interface Conta {
  id: number;
  tipo: TipoConta;
  descricao: string;
  categoria: string | null;
  contraparte: string | null;
  valor: number;
  vencimento: string;
  status: StatusConta;
  dataPagamento: string | null;
  // o DRE precisa separar aluguel e salário do que varia com a produção
  custoFixo: boolean;
  observacao: string | null;
  // Boleto, Cheque, Pix. Cheque tem compensação própria, e a conciliação
  // bancária casa o movimento do extrato pelo nº do documento.
  formaPagamento: string | null;
  documento: string | null;
  atrasada: boolean;
  diasParaVencer: number;
}

export type ContaEntrada = Omit<Conta, "id" | "atrasada" | "diasParaVencer"> & {
  // cria a mesma conta nos próximos N meses, mantendo o dia do vencimento
  repetirMeses?: number;
};

// aReceber não é digitado: é o que as lojas devem, de pedidos menos pagamentos
export interface ResumoContas {
  aPagar: number;
  aReceber: number;
  pago: number;
  recebido: number;
  atrasado: number;
  custoFixo: number;
  custoVariavel: number;
}
