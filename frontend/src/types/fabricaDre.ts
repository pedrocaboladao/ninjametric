// DRE da Fábrica Distribuidora — só desta operação. Nada aqui olha pedidos,
// financeiro ou contas das 20 lojas.
//
// Competência, não caixa: o pedido entra na data do pedido, a conta entra no
// vencimento. Um mês em que a loja atrasou o PIX não pode parecer um mês ruim
// de venda.
export interface LinhaCategoria {
  categoria: string;
  valor: number;
}

export interface LinhaProduto {
  produtoId: number;
  sku: string;
  nome: string;
  quantidade: number;
  receita: number;
  custo: number;
  margem: number;
  percentualMargem: number;
}

export interface Dre {
  de: string;
  ate: string;

  receita: number;
  custoProdutos: number;
  margemContribuicao: number;
  percentualMargem: number;

  despesaFixa: number;
  despesaVariavel: number;
  despesaTotal: number;
  resultado: number;
  percentualResultado: number;

  // quanto precisa vender pra pagar a despesa fixa
  pontoEquilibrio: number;

  porCategoria: LinhaCategoria[];
  porProduto: LinhaProduto[];

  // compras que já estão dentro do custo dos produtos — ficam fora do
  // resultado pra não contar o mesmo dinheiro duas vezes
  jaNoCusto: LinhaCategoria[];
  jaNoCustoTotal: number;

  pedidos: number;
  clientes: number;
}
