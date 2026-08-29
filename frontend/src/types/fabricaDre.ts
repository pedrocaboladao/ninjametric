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
  // Enquanto nao ha produto cadastrado, o faturamento e digitado como conta a
  // receber. Separado da receita de pedido pra dar pra ver, na virada, qual
  // das duas fontes esta alimentando o mes.
  receitaPedidos: number;
  receitaLancada: number;
  receitaDeDuasFontes: boolean;
  // credito das devolucoes: reduz a receita porque a venda foi desfeita
  devolucoes: number;
  // Bonificacao por pagar em dia. Nao e desconto sobre a venda — a venda saiu
  // pelo valor cheio — mas e dinheiro que a fabrica deixa de receber, entao
  // sai da receita. A antecipacao nao entra: aquilo e a loja pagando antes.
  bonificacao: number;
  percentualBonificacao: number;
  unidadesDevolvidas: number;
  unidadesPerdidas: number;
  receitaVendas: number;
  // provisao pela aliquota do mes, nao pela guia paga
  percentualImposto: number;
  impostoHerdadoDe: string | null;
  imposto: number;
  // o que a guia lancada no contas a pagar deste mes cobra
  impostoLancado: number;
  receitaLiquida: number;
  custoProdutos: number;
  // O que a fábrica consumiu do próprio estoque. Não é custo do que foi vendido
  // — não foi vendido. Já está dentro de despesaVariavel; a linha só separa.
  consumoProprio: number;
  // mercadoria comprada pronta pra revender: CPV da distribuidora
  custoRevenda: number;
  margemContribuicao: number;
  percentualMargem: number;

  despesaFixa: number;
  despesaVariavel: number;
  // desgaste dos bens no mes, vindo do cadastro de bens. A parcela do
  // financiamento nao entra aqui: quem representa o bem no DRE e isto.
  depreciacao: number;
  depreciacaoPorBem: { nome: string; valor: number }[];
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
