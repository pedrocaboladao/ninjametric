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
