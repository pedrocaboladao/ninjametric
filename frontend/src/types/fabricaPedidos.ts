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
  tipo: "pedido" | "pagamento";
  referencia: number;
  descricao: string;
  valor: number;
  saldo: number;
}
