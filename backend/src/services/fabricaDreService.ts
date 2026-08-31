import { pool } from "../db/pool";
import { depreciacaoDoMes } from "./fabricaBensService";
import { dataIso } from "./fabricaData";
import { totaisDoPeriodo } from "./fabricaDevolucoesService";

// DRE da Fábrica Distribuidora — só desta operação.
//
// Nada aqui olha pedidos, financeiro ou contas das 20 lojas. A fábrica é outra
// empresa: vende pras lojas, e o que a loja faz com a tinta depois é problema
// do DRE dela.
//
// Competência, não caixa: o pedido entra na data do pedido (não na data em que
// a loja pagou), e a conta entra no vencimento (não no pagamento). Um mês em
// que a loja atrasou o PIX não pode parecer um mês ruim de venda.

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
  // receber. Fica separado da receita de pedido pra dar pra ver, na virada,
  // qual das duas fontes esta alimentando o mes.
  receitaPedidos: number;
  receitaLancada: number;
  // as duas fontes juntas no mesmo mes = risco de contar a mesma venda duas
  // vezes. A tela mostra o aviso em vez de somar calado.
  receitaDeDuasFontes: boolean;
  // credito das devolucoes: reduz a receita porque a venda foi desfeita
  devolucoes: number;
  // Bonificacao de 3,5% por pagar em dia. Nao e desconto sobre a venda: a
  // venda saiu pelo valor cheio e o premio vira credito pra proxima compra.
  // Mas e dinheiro que a fabrica deixa de receber, entao sai da receita aqui
  // — senao a margem fica alta por causa de um desconto que ja foi dado.
  //
  // A antecipacao NAO entra: aquilo e a loja pagando antes, nao a fabrica
  // ganhando menos.
  bonificacao: number;
  percentualBonificacao: number;
  // unidades que voltaram e unidades que viraram perda (estourado/quebrado)
  unidadesDevolvidas: number;
  unidadesPerdidas: number;
  receitaVendas: number;
  // imposto sobre a venda: provisao pela aliquota do mes, nao pela guia paga
  percentualImposto: number;
  // de qual mes veio a aliquota, quando este mes nao tem uma propria
  impostoHerdadoDe: string | null;
  imposto: number;
  // o que a guia de imposto lancada no contas a pagar deste mes cobra. Serve
  // pra conferir se a % provisionada ficou por cima ou por baixo, e refazer.
  impostoLancado: number;
  receitaLiquida: number;
  custoProdutos: number;
  // O que a fábrica consumiu do próprio estoque no período.
  //
  // Saco, fita e caixa saem por duas portas: venda pra loja e uso na expedição.
  // A venda já aparece pelo item do pedido. O uso interno saía só pelo ajuste de
  // estoque, que baixava o saldo e não levava custo pra lugar nenhum — consumir
  // R$ 5.000 de saco deixava o lucro do mês R$ 5.000 maior do que foi.
  //
  // Não é custo do produto vendido: não foi vendido. É despesa da operação.
  consumoProprio: number;
  // compra de mercadoria pra revender: CPV da distribuidora, nao despesa
  custoRevenda: number;
  margemContribuicao: number;
  percentualMargem: number;

  despesaFixa: number;
  despesaVariavel: number;
  // desgaste dos bens no mes: sai do cadastro de bens, nao do contas a pagar
  depreciacao: number;
  depreciacaoPorBem: { nome: string; valor: number }[];
  despesaTotal: number;
  resultado: number;
  percentualResultado: number;

  // ponto de equilíbrio: quanto precisa vender pra pagar a despesa fixa
  pontoEquilibrio: number;

  porCategoria: LinhaCategoria[];
  porProduto: LinhaProduto[];

  // compras que JÁ estão dentro do custo dos produtos — ficam fora do
  // resultado pra não contar o mesmo dinheiro duas vezes
  jaNoCusto: LinhaCategoria[];
  jaNoCustoTotal: number;

  pedidos: number;
  clientes: number;
}

// Categorias que representam compra de insumo, não despesa do período. A
// matéria-prima e a embalagem já entram no resultado pelo custo do produto
// vendido; somá-las de novo aqui contaria o mesmo dinheiro duas vezes.
//
// Elas não somem: aparecem num bloco separado, porque o dinheiro saiu do caixa
// e some do relatório seria pior que aparecer no lugar errado.
//
// ÁGUA e CONSUMO saíram desta lista.
//
// O teste pra estar aqui é um só: **isso sai pela porta dentro de um produto
// vendido?** Se sai, é estoque e volta ao resultado como custo do produto. Se
// não sai, é despesa do mês.
//
// A conta da Sanepar não sai pela porta: é consumo do barracão, e ficava fora
// do resultado sem aparecer em despesa nenhuma — R$ 2.156,60 saindo do caixa
// e não chegando em lugar nenhum. Se um dia a água virar ingrediente medido,
// ela entra por MATÉRIA-PRIMA, pela nota do fornecedor de insumo, nunca pela
// conta da concessionária.
//
// CONSUMO segurava EPI, plástico e chave de abrir balde — proteção do
// funcionário e ferramenta, que são despesa do mês. O consumo próprio de
// produto acabado, esse sim, tem caminho proprio: entra por `consumoProprio`,
// pelo ajuste de estoque, e nao por conta a pagar.
const CATEGORIAS_DE_INSUMO = new Set(["MATÉRIA-PRIMA", "EMBALAGEM"]);

// Produto pronto comprado pra revender — 93% do contas a pagar da fabrica.
//
// Segue a mesma regra da materia-prima logo acima, e pelo mesmo motivo: o custo
// de compra ja esta gravado dentro do item do pedido, entao somar a nota de
// compra de novo conta o mesmo dinheiro duas vezes.
//
// Ate hoje somava, e nao dava erro visivel porque o item do pedido de agosto
// estava com custo ZERO — o unico jeito de ver o custo da revenda era pela nota.
// Preenchido o custo dos 13.212 itens, os dois passaram a valer ao mesmo tempo:
// CPV virou R$ 3.850.291,78 contra R$ 3.069.007,80 de receita, e o mes fechou
// com prejuizo de R$ 842.739,39 que nao existe.
//
// Nota de compra e estoque, nao custo da venda. Ela continua no bloco separado,
// junto com a materia-prima: o dinheiro saiu do caixa e sumir seria pior.
const CATEGORIA_REVENDA = "REVENDA";

// Parcela de bem financiado. Fica fora do resultado: quem representa o bem no
// DRE e a depreciacao, tirada do cadastro de bens. Contar os dois seria cobrar
// o caminhao duas vezes — uma pelo cheque, outra pelo desgaste.
const CATEGORIA_IMOBILIZADO = "IMOBILIZADO";

// Parcela de divida: o principal e caixa, quem e despesa e o juro.
//
// ADIANTAMENTO NAO entra aqui, e a historia vale ser contada porque eu errei
// duas vezes antes de acertar.
//
// O holerite tem a linha "Desconto de Adiantamento Salarial", e isso parece
// dizer que o adiantamento volta na folha — logo, lancar os dois seria dobra.
// Nao e. O desconto significa que o funcionario nao recebe duas vezes; a
// empresa desembolsa as duas. O que decide e outra pergunta: **o lancamento do
// dia 5 e o salario cheio ou o que sobrou depois do adiantamento?**
//
// A conta dos salarios reais respondeu:
//
//   Carlos    ganha 6.000,00   lancado 3.000,00 + 3.000,00 = 6.000,00
//   Ricardo   ganha 3.750,00   lancado 2.300,00 + 1.500,00 = 3.800,00
//
// Os dois so fecham somando. Cada lancamento e uma parcela que saiu do banco,
// nao o bruto da folha. Tirar o adiantamento do resultado escondia R$ 1.450,00
// por mes so do Ricardo.
//
// O que me enganou: o Douglas ganha exatamente 2.300,00, entao no holerite dele
// o valor do dia 5 e mesmo o salario base. Peguei o caso de um funcionario e
// apliquei nos tres.
const CATEGORIAS_DE_CAIXA = new Set(["EMPRÉSTIMO"]);

// Alíquota do mês, ou a do mês anterior mais recente. Assim não precisa
// digitar todo mês, mas o histórico fica preso ao que valia na época.
export async function aliquotaDoMes(
  competencia: string
): Promise<{ percentual: number; herdadoDe: string | null }> {
  const { rows } = await pool.query<{ competencia: string; percentual: string }>(
    `SELECT competencia, percentual FROM fabrica_impostos
     WHERE competencia <= $1::date ORDER BY competencia DESC LIMIT 1`,
    [competencia]
  );
  if (!rows.length) return { percentual: 0, herdadoDe: null };
  const mes = dataIso(rows[0].competencia).slice(0, 7);
  return {
    percentual: Number(rows[0].percentual),
    herdadoDe: mes === competencia.slice(0, 7) ? null : mes,
  };
}

export async function definirAliquota(competencia: string, percentual: number): Promise<void> {
  const primeiro = `${competencia.slice(0, 7)}-01`;
  await pool.query(
    `INSERT INTO fabrica_impostos (competencia, percentual) VALUES ($1::date, $2)
     ON CONFLICT (competencia) DO UPDATE
       SET percentual = EXCLUDED.percentual, atualizado_em = now()`,
    [primeiro, percentual]
  );
}

function mesAtual(): { de: string; ate: string } {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const [ano, mes] = hoje.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const mm = String(mes).padStart(2, "0");
  return { de: `${ano}-${mm}-01`, ate: `${ano}-${mm}-${ultimoDia}` };
}

export async function montarDre(deEntrada?: string, ateEntrada?: string): Promise<Dre> {
  const padrao = mesAtual();
  const de = deEntrada || padrao.de;
  const ate = ateEntrada || padrao.ate;

  const [aliquota, devolucao, depreciacao, bonif] = await Promise.all([
    aliquotaDoMes(de),
    totaisDoPeriodo(de, ate),
    depreciacaoDoMes(de),
    // so BONIFICACAO confirmada: a antecipacao e forma de pagamento e nao
    // custo, e a provisoria ainda pode ser apagada no fim do mes — tirar da
    // receita agora seria dar por perdido um dinheiro que talvez volte
    pool.query<{ total: string; percentual: string }>(
      `SELECT COALESCE(SUM(cr.valor), 0) AS total,
              (SELECT percentual FROM fabrica_bonificacao WHERE id = 1) AS percentual
       FROM fabrica_creditos cr
       WHERE cr.origem = 'BONIFICACAO' AND NOT cr.provisorio
         AND cr.data BETWEEN $1::date AND $2::date`,
      [de, ate]
    ),
  ]);
  const bonificacao = Number(bonif.rows[0]?.total ?? 0);
  const percentualBonif = Number(bonif.rows[0]?.percentual ?? 3.5);

  const [vendas, contas, resumoPedidos, receber, consumo] = await Promise.all([
    // receita e custo saem do item do pedido, onde ficaram GRAVADOS no
    // lançamento. Recalcular com o custo de hoje mudaria o resultado de um mês
    // já fechado toda vez que a resina mudasse de preço.
    pool.query<{
      produto_id: number;
      sku: string;
      nome: string;
      quantidade: string;
      receita: string;
      custo: string;
    }>(
      `SELECT i.produto_id, pr.sku, pr.nome,
              SUM(i.quantidade)                        AS quantidade,
              SUM(i.quantidade * i.preco_unitario)     AS receita,
              SUM(i.quantidade * i.custo_unitario)     AS custo
       FROM fabrica_pedido_itens i
       JOIN fabrica_pedidos p ON p.id = i.pedido_id
       JOIN fabrica_produtos pr ON pr.id = i.produto_id
       WHERE p.status <> 'CANCELADO' AND p.data >= $1::date AND p.data <= $2::date
       GROUP BY i.produto_id, pr.sku, pr.nome`,
      [de, ate]
    ),
    pool.query<{ categoria: string | null; custo_fixo: boolean; total: string }>(
      `SELECT COALESCE(categoria, 'SEM CATEGORIA') AS categoria, custo_fixo, SUM(valor) AS total
       FROM fabrica_contas
       WHERE tipo = 'pagar' AND status <> 'cancelado'
         AND vencimento >= $1::date AND vencimento <= $2::date
       GROUP BY categoria, custo_fixo`,
      [de, ate]
    ),
    pool.query<{ pedidos: string; clientes: string }>(
      `SELECT COUNT(*) AS pedidos, COUNT(DISTINCT cliente_id) AS clientes
       FROM fabrica_pedidos
       WHERE status <> 'CANCELADO' AND data >= $1::date AND data <= $2::date`,
      [de, ate]
    ),
    // faturamento digitado a mao, pela mesma regra de competencia das
    // despesas: entra no mes do vencimento, nao no mes em que a loja pagou
    pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(valor), 0) AS total
       FROM fabrica_contas
       WHERE tipo = 'receber' AND status <> 'cancelado'
         AND vencimento >= $1::date AND vencimento <= $2::date`,
      [de, ate]
    ),
    // Consumo próprio: o ajuste marcado como uso da fábrica, pelo custo gravado
    // no momento. A quantidade é negativa (saiu do estoque), então o ABS.
    pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(ABS(quantidade) * COALESCE(custo_unitario, 0)), 0) AS total
       FROM fabrica_produto_ajustes
       WHERE consumo = TRUE AND data >= $1::date AND data <= $2::date`,
      [de, ate]
    ),
  ]);

  const porProduto: LinhaProduto[] = vendas.rows.map((r) => {
    const receita = Number(r.receita);
    const custo = Number(r.custo);
    const margem = receita - custo;
    return {
      produtoId: r.produto_id,
      sku: r.sku,
      nome: r.nome,
      quantidade: Number(r.quantidade),
      receita,
      custo,
      margem,
      percentualMargem: receita > 0 ? margem / receita : 0,
    };
  });
  porProduto.sort((a, b) => b.receita - a.receita);

  const receitaPedidos = porProduto.reduce((s, p) => s + p.receita, 0);
  const receitaLancada = Number(receber.rows[0]?.total ?? 0);
  const receita = receitaPedidos + receitaLancada;
  // a venda devolvida foi desfeita: nao pode pagar imposto nem ficar na receita
  const receitaVendas = receita - devolucao.credito - bonificacao;
  const imposto = receitaVendas * (aliquota.percentual / 100);
  const receitaLiquida = receitaVendas - imposto;
  // o produto que voltou inteiro esta na prateleira de novo: o custo dele sai
  // do CPV, senao a fabrica pagaria duas vezes pelo mesmo balde. O avariado
  // continua no custo, porque virou perda de verdade.
  const custoFabricado =
    porProduto.reduce((s, p) => s + p.custo, 0) - devolucao.custoRetornado;
  let despesaFixa = 0;
  let despesaVariavel = 0;
  let custoRevenda = 0;
  let jaNoCustoTotal = 0;
  let impostoLancado = 0;
  const categorias = new Map<string, number>();
  const insumos = new Map<string, number>();

  for (const r of contas.rows) {
    const categoria = r.categoria ?? "SEM CATEGORIA";
    const total = Number(r.total);
    // com alíquota definida, a guia de imposto já foi provisionada no mês da
    // venda: contar de novo aqui mostraria o mesmo imposto em dois meses. Sem
    // alíquota, ela é despesa normal — senão o imposto sumiria do resultado.
    const impostoJaProvisionado = categoria === "IMPOSTO" && aliquota.percentual > 0;
    if (impostoJaProvisionado) {
      impostoLancado += total;
      continue;
    }
    if (categoria === CATEGORIA_REVENDA) {
      custoRevenda += total;
      insumos.set(categoria, (insumos.get(categoria) ?? 0) + total);
      jaNoCustoTotal += total;
      continue;
    }
    if (CATEGORIAS_DE_CAIXA.has(categoria)) {
      // aparece no bloco de fora do resultado: o dinheiro saiu do caixa e
      // sumir do relatorio seria pior que aparecer no lugar errado
      insumos.set(categoria, (insumos.get(categoria) ?? 0) + total);
      jaNoCustoTotal += total;
      continue;
    }
    if (categoria === CATEGORIA_IMOBILIZADO) {
      // aparece no bloco de fora do resultado: o dinheiro saiu do caixa e
      // sumir do relatorio seria pior que aparecer no lugar errado
      insumos.set(categoria, (insumos.get(categoria) ?? 0) + total);
      jaNoCustoTotal += total;
      continue;
    }
    if (CATEGORIAS_DE_INSUMO.has(categoria)) {
      insumos.set(categoria, (insumos.get(categoria) ?? 0) + total);
      jaNoCustoTotal += total;
      continue;
    }
    categorias.set(categoria, (categorias.get(categoria) ?? 0) + total);
    if (r.custo_fixo) despesaFixa += total;
    else despesaVariavel += total;
  }

  // so o custo do que foi vendido. `custoRevenda` continua sendo devolvido pra
  // tela mostrar quanto a fabrica comprou no mes, mas nao entra no resultado.
  const custoProdutos = custoFabricado;
  // despesa da operação, não custo do que foi vendido: não foi vendido
  const consumoProprio = Number(consumo.rows[0]?.total ?? 0);
  despesaVariavel += consumoProprio;
  const margemContribuicao = receitaLiquida - custoProdutos;
  // depreciacao e despesa fixa: acontece com ou sem venda no mes
  despesaFixa += depreciacao.total;
  const despesaTotal = despesaFixa + despesaVariavel;
  const resultado = margemContribuicao - despesaTotal;
  // margem sobre a receita LIQUIDA: e o dinheiro que a fabrica de fato recebe,
  // e e ele que tem que pagar a despesa fixa
  const percentualMargem = receitaLiquida > 0 ? margemContribuicao / receitaLiquida : 0;

  const ordenar = (m: Map<string, number>): LinhaCategoria[] =>
    [...m.entries()]
      .map(([categoria, valor]) => ({ categoria, valor }))
      .sort((a, b) => b.valor - a.valor);

  return {
    de,
    ate,
    receita,
    receitaPedidos,
    receitaLancada,
    receitaDeDuasFontes: receitaPedidos > 0 && receitaLancada > 0,
    devolucoes: devolucao.credito,
    bonificacao,
    percentualBonificacao: percentualBonif,
    unidadesDevolvidas: devolucao.unidades,
    unidadesPerdidas: devolucao.perdidas,
    receitaVendas,
    percentualImposto: aliquota.percentual,
    impostoHerdadoDe: aliquota.herdadoDe,
    imposto,
    impostoLancado,
    receitaLiquida,
    custoProdutos,
    consumoProprio,
    custoRevenda,
    margemContribuicao,
    percentualMargem,
    despesaFixa,
    despesaVariavel,
    depreciacao: depreciacao.total,
    depreciacaoPorBem: depreciacao.porBem,
    despesaTotal,
    resultado,
    percentualResultado: receita > 0 ? resultado / receita : 0,
    // com margem de 40%, cada real vendido paga 40 centavos de despesa fixa —
    // então o equilíbrio é a fixa dividida pela margem. Sem margem apurada não
    // dá pra dizer, e chutar zero faria parecer que não precisa vender nada.
    pontoEquilibrio: percentualMargem > 0 ? despesaFixa / percentualMargem : 0,
    porCategoria: ordenar(categorias),
    porProduto,
    jaNoCusto: ordenar(insumos),
    jaNoCustoTotal,
    pedidos: Number(resumoPedidos.rows[0]?.pedidos ?? 0),
    clientes: Number(resumoPedidos.rows[0]?.clientes ?? 0),
  };
}
