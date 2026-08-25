// Pedido de venda da Fábrica Distribuidora: a fábrica vendendo pras lojas do
// grupo e pra clientes de fora. Não confundir com as vendas do Mercado Livre
// que o Financeiro acompanha — ali é a loja vendendo pro consumidor.
export type StatusPedido = "ABERTO" | "ENTREGUE" | "CANCELADO";

// Preço e custo ficam gravados no item. Uma venda que aconteceu é um fato:
// recalcular a margem de um pedido antigo com o custo de hoje mudaria o
// histórico sozinho.
export interface ItemPedido {
  id: number;
  produtoId: number;
  produtoSku: string;
  produtoNome: string;
  quantidade: number;
  precoUnitario: number;
  custoUnitario: number;
  total: number;
  custoTotal: number;
  margemContribuicao: number;
  percentualLucro: number;
}

export interface Pedido {
  id: number;
  clienteId: number;
  clienteNome: string;
  clienteTipo: string;
  data: string;
  status: StatusPedido;
  observacao: string | null;
  itens: ItemPedido[];
  total: number;
  custoTotal: number;
  margemContribuicao: number;
  percentualLucro: number;
}

export interface ItemEntrada {
  produtoId: number;
  quantidade: number;
  // vazio significa "usa o preço do cadastro", não "de graça"
  precoUnitario?: number | null;
}

export interface PedidoEntrada {
  clienteId: number;
  data: string | null;
  status: StatusPedido;
  observacao: string | null;
  itens: ItemEntrada[];
}

// Estoque de produto acabado: entra pelo envase do lote, sai pelo pedido.
export interface EstoqueProduto {
  produtoId: number;
  sku: string;
  nome: string;
  produzido: number;
  vendido: number;
  devolvido: number;
  ajustes: number;
  saldo: number;
  estoqueMinimo: number;
  abaixoDoMinimo: boolean;
  custoUnitario: number;
  valorEmEstoque: number;
  // produto sem fórmula ou sem embalagem no cadastro não tem como ser
  // produzido automaticamente pelo lote
  semCadastroCompleto: boolean;
}

export interface AjusteProduto {
  id: number;
  produtoId: number;
  produtoNome: string;
  data: string;
  quantidade: number;
  motivo: string | null;
}

// Conta corrente da loja com a fábrica. Não existe "conta a receber" guardada:
// o que a loja deve sai de pedidos menos pagamentos, recalculado.
export interface ContaCorrente {
  clienteId: number;
  clienteNome: string;
  clienteTipo: string;
  comprado: number;
  pago: number;
  // credito de devolucao — abate no fechamento igual a um pagamento
  credito: number;
  // saldo em conta: antecipação paga adiantado + bonificação de 3,5% por
  // quitar em dia. Abate igual a devolução, mas vem de outra tabela.
  creditoConta: number;
  saldo: number;
  ultimoPedido: string | null;
  ultimoPagamento: string | null;
}

export interface Pagamento {
  id: number;
  clienteId: number;
  clienteNome: string;
  data: string;
  valor: number;
  observacao: string | null;
}

// Extrato pra mandar pra loja na terça: pedidos e pagamentos na mesma linha do
// tempo, com o saldo correndo.
export interface LinhaExtrato {
  data: string;
  tipo: "pedido" | "pagamento" | "devolucao";
  referencia: number;
  descricao: string;
  valor: number;
  saldo: number;
}

// Devolucao: o caminho de volta da mercadoria. Tres finais possiveis, e eles
// nao sao a mesma coisa nem no estoque nem no dinheiro.
export type CondicaoDevolucao = "BOM" | "ESTOURADO" | "QUEBRADO";

export interface Devolucao {
  id: number;
  clienteId: number;
  clienteNome: string;
  produtoId: number;
  produtoSku: string;
  produtoNome: string;
  data: string;
  quantidade: number;
  condicao: CondicaoDevolucao;
  credito: number;
  custoUnitario: number;
  notaFiscal: string | null;
  notaCancelada: boolean;
  ressarcimentoStatus: StatusRessarcimento;
  ressarcimentoValor: number;
  ressarcimentoData: string | null;
  ressarcimentoProtocolo: string | null;
  recebidoPor: string | null;
  observacao: string | null;
  voltouAoEstoque: boolean;
  custoTotal: number;
  // quanto a mercadoria valia pra loja, pelo preco que ela pagou
  valorDaMercadoria: number;
  // o que sobrou descoberto: nem o ML pagou, nem a fabrica creditou
  descoberto: number;
}

// O funcionario manda foto pro ML e pede ressarcimento pela avaria. O dinheiro
// cai na conta da LOJA, nao da fabrica. Lancar aqui e o que impede a avaria de
// parecer perda total quando o ML ja cobriu.
export type StatusRessarcimento = "NAO_PEDIDO" | "PEDIDO" | "RECEBIDO" | "NEGADO";

export interface ConsolidadoRessarcimento {
  avarias: number;
  valorAvariado: number;
  naoPedido: number;
  pedido: number;
  recebido: number;
  negado: number;
  recebidoValor: number;
  creditoDado: number;
  descoberto: number;
}

// Crédito da loja na fábrica. A antecipação é dinheiro que ela pagou antes de
// comprar; a bonificação é o prêmio de 3,5% por quitar 100% do fechamento.
// Nenhum dos dois é desconto sobre a venda — são formas de pagar a próxima.
export type OrigemCredito =
  | "ANTECIPACAO"
  | "BONIFICACAO"
  | "AJUSTE"
  | "USO"
  // o que a loja já devia quando o sistema começou. Sempre negativo.
  | "SALDO_ANTERIOR";

export interface Credito {
  id: number;
  clienteId: number;
  clienteNome: string;
  data: string;
  origem: OrigemCredito;
  valor: number;
  pagamentoId: number | null;
  observacao: string | null;
  // pagou parte e já levou os 3,5%, mas ainda não quitou. Vira definitivo no
  // pagamento que zerar a conta, ou some se ela virar o mês devendo.
  provisorio: boolean;
}

// Loja com crédito provisório pendurado e conta ainda aberta.
export interface AlertaProvisorio {
  clienteId: number;
  clienteNome: string;
  provisorio: number;
  devendo: number;
  mesMaisAntigo: string;
  // virou o mês e ela não quitou o anterior: o crédito deveria cair
  venceu: boolean;
}

export interface SaldoCredito {
  clienteId: number;
  clienteNome: string;
  clientePaiId: number | null;
  clientePaiNome: string | null;
  antecipado: number;
  bonificado: number;
  ajuste: number;
  // dívida trazida de antes do sistema. Sempre negativo.
  anterior: number;
  usado: number;
  // bonificação pendurada: aparece, mas não abate até a loja quitar
  provisorio: number;
  // o que de fato abate hoje — só o que já está confirmado
  saldo: number;
}

// Idade do saldo: ha quanto tempo cada loja esta devendo.
//
// A conta corrente diz quanto, nunca desde quando — pagamento parcial e a
// regra e ninguem escolhe qual pedido foi quitado. A convencao usada e a que a
// fabrica ja pratica: paga-se o mais velho primeiro.
export interface FaixaIdade {
  rotulo: string;
  valor: number;
}

export interface IdadeCliente {
  clienteId: number;
  clienteNome: string;
  clientePaiId: number | null;
  clientePaiNome: string | null;
  total: number;
  aVencer: number;
  faixas: FaixaIdade[];
  maisVelho: string | null;
  diasMaisVelho: number;
}

// Uma linha da planilha de venda depois de conferida.
export interface LinhaPlanilha {
  linha: number;
  cliente: string;
  clienteId: number | null;
  data: string | null;
  documento: string | null;
  sku: string;
  produtoId: number | null;
  produtoNome: string | null;
  quantidade: number;
  precoUnitario: number;
  total: number;
  problema: string | null;
  jaImportada: boolean;
}

// SKU que apareceu na planilha e nao existe no cadastro. E o alerta pra
// cadastrar na hora, com o preco que a loja pagou de verdade como sugestao.
export interface SkuFaltando {
  sku: string;
  linhas: number;
  quantidade: number;
  valor: number;
  precoUnitario: number;
  clientes: string[];
}

export interface ConferenciaPlanilha {
  origem: string;
  linhas: LinhaPlanilha[];
  prontas: number;
  comProblema: number;
  jaImportadas: number;
  totalValor: number;
  colunas: Record<string, string>;
  linhasNoArquivo: number;
  linhasVazias: number;
  skusFaltando: SkuFaltando[];
}

export interface ResultadoImportacao {
  pedidosCriados: number;
  itensLancados: number;
  valorLancado: number;
  puladas: number;
  motivos: Record<string, number>;
}

export interface IdadeSaldo {
  hoje: string;
  // prazo do ciclo: pega em sete dias, paga no oitavo
  diasAteVencer: number;
  clientes: IdadeCliente[];
  totais: { total: number; aVencer: number; faixas: FaixaIdade[] };
}
