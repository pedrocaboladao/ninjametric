import { pool } from "../db/pool";
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
  // credito das devolucoes: reduz a receita porque a venda foi desfeita
  devolucoes: number;
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
  margemContribuicao: number;
  percentualMargem: number;

  despesaFixa: number;
  despesaVariavel: number;
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
const CATEGORIAS_DE_INSUMO = new Set(["MATÉRIA-PRIMA", "EMBALAGEM", "ÁGUA", "CONSUMO"]);

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
  const mes = String(rows[0].competencia).slice(0, 7);
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

  const [aliquota, devolucao] = await Promise.all([aliquotaDoMes(de), totaisDoPeriodo(de, ate)]);

  const [vendas, contas, resumoPedidos] = await Promise.all([
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

  const receita = porProduto.reduce((s, p) => s + p.receita, 0);
  // a venda devolvida foi desfeita: nao pode pagar imposto nem ficar na receita
  const receitaVendas = receita - devolucao.credito;
  const imposto = receitaVendas * (aliquota.percentual / 100);
  const receitaLiquida = receitaVendas - imposto;
  // o produto que voltou inteiro esta na prateleira de novo: o custo dele sai
  // do CPV, senao a fabrica pagaria duas vezes pelo mesmo balde. O avariado
  // continua no custo, porque virou perda de verdade.
  const custoProdutos =
    porProduto.reduce((s, p) => s + p.custo, 0) - devolucao.custoRetornado;
  const margemContribuicao = receitaLiquida - custoProdutos;

  let despesaFixa = 0;
  let despesaVariavel = 0;
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
    if (CATEGORIAS_DE_INSUMO.has(categoria)) {
      insumos.set(categoria, (insumos.get(categoria) ?? 0) + total);
      jaNoCustoTotal += total;
      continue;
    }
    categorias.set(categoria, (categorias.get(categoria) ?? 0) + total);
    if (r.custo_fixo) despesaFixa += total;
    else despesaVariavel += total;
  }

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
    devolucoes: devolucao.credito,
    unidadesDevolvidas: devolucao.unidades,
    unidadesPerdidas: devolucao.perdidas,
    receitaVendas,
    percentualImposto: aliquota.percentual,
    impostoHerdadoDe: aliquota.herdadoDe,
    imposto,
    impostoLancado,
    receitaLiquida,
    custoProdutos,
    margemContribuicao,
    percentualMargem,
    despesaFixa,
    despesaVariavel,
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
