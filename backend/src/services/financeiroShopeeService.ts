import { pool } from "../db/pool";
import { listarPedidos, buscarDetalhesPedidos, buscarTaxasPedidos } from "./shopeeApi";
import { listarProdutos } from "./produtosService";
import { janelaUltimosDias, janelaEntre } from "./dateUtils";
import { obterGastoAdsShopee } from "./shopeeAdsService";

const DIAS_JANELA = 7;

// Enum de status real da Shopee ainda não confirmado contra uma resposta ao
// vivo (a loja piloto não teve pedido de verdade até agora) — usa o
// conjunto documentado publicamente. Revisar assim que o primeiro pedido
// real da Catedral aparecer.
const STATUS_CANCELADOS = new Set(["CANCELLED", "IN_CANCEL"]);
const STATUS_NAO_PAGOS = new Set(["UNPAID", "INVOICE_PENDING"]);

function pedidoValido(status: string): boolean {
  return !STATUS_CANCELADOS.has(status) && !STATUS_NAO_PAGOS.has(status);
}

// Mesma lógica de normalização do Financeiro do Mercado Livre
// (financeiroService.ts) — SKU é a mesma planilha de produtos pros dois
// canais, então precisa bater igual. Duplicado de propósito (convenção
// deste projeto: helper pequeno por arquivo, não compartilhado).
export function normalizarSku(sku: string): string {
  return sku
    .toLowerCase()
    .replace(/á/g, "a")
    .replace(/à/g, "a")
    .replace(/ã/g, "a")
    .replace(/â/g, "a")
    .replace(/ä/g, "a")
    .replace(/é/g, "e")
    .replace(/è/g, "e")
    .replace(/ê/g, "e")
    .replace(/ë/g, "e")
    .replace(/í/g, "i")
    .replace(/ì/g, "i")
    .replace(/î/g, "i")
    .replace(/ï/g, "i")
    .replace(/ó/g, "o")
    .replace(/ò/g, "o")
    .replace(/õ/g, "o")
    .replace(/ô/g, "o")
    .replace(/ö/g, "o")
    .replace(/ú/g, "u")
    .replace(/ù/g, "u")
    .replace(/û/g, "u")
    .replace(/ü/g, "u")
    .replace(/ç/g, "c")
    .replace(/ñ/g, "n")
    .trim()
    .toUpperCase()
    .replace(/[\s\-/]+/g, "");
}

function arredondarCentavos(valor: number): number {
  return Math.round((valor + 1e-9) * 100) / 100;
}

export interface VendaFinanceiraShopee {
  orderSn: string;
  itemId: number;
  dataCriacao: string;
  lojaId: number;
  lojaNome: string;
  titulo: string;
  sku: string | null;
  valorUnitario: number;
  quantidade: number;
  receitaTotal: number;
  custoTotal: number | null;
  impostoTotal: number;
  taxaShopeeTotal: number;
  cupomVendedorTotal: number;
  freteVendedorTotal: number;
  margemContribuicao: number | null;
  margemPercentual: number | null;
}

export interface ResumoPedidosShopee {
  totalPedidos: number;
  pedidosAprovados: number;
  pedidosCancelados: number;
  // A Shopee não devolve o valor do pedido em get_order_list (só em
  // get_order_detail) — buscar o detalhe de pedidos cancelados só pra essa
  // métrica não vale o custo de mais uma chamada por enquanto. Fica 0.
  valorCancelado: number;
}

export interface ResultadoFinanceiroShopee {
  vendas: VendaFinanceiraShopee[];
  resumoPedidos: ResumoPedidosShopee;
  gastoAdsTotal: number;
}

interface LojaShopee {
  id: number;
  nome: string;
  imposto_percentual: number;
}

async function listarLojasComShopee(): Promise<LojaShopee[]> {
  const { rows } = await pool.query<LojaShopee>(
    `SELECT l.id, l.nome, l.imposto_percentual
     FROM lojas l
     JOIN contas_shopee c ON c.loja_id = l.id
     ORDER BY l.id`
  );
  return rows;
}

// Mesmo cache de 15 min do Financeiro do Mercado Livre — feed de atividade
// recente, não precisa reprocessar tudo a cada requisição.
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { data: ResultadoFinanceiroShopee; expiraEm: number }>();

export async function listarVendasFinanceirasShopee(
  lojaIdFiltro?: number,
  lojasPermitidas?: number[],
  dataInicio?: string,
  dataFim?: string,
  forcarAtualizacao = false
): Promise<ResultadoFinanceiroShopee> {
  const lojas = (await listarLojasComShopee()).filter(
    (l) =>
      (lojaIdFiltro === undefined || l.id === lojaIdFiltro) &&
      (lojasPermitidas === undefined || lojasPermitidas.includes(l.id))
  );

  const chaveCache = `${lojas
    .map((l) => l.id)
    .sort((a, b) => a - b)
    .join(",")}|${dataInicio ?? ""}|${dataFim ?? ""}`;
  const emCache = cache.get(chaveCache);
  if (!forcarAtualizacao && emCache && emCache.expiraEm > Date.now()) {
    return emCache.data;
  }

  const janela = dataInicio && dataFim ? janelaEntre(dataInicio, dataFim) : janelaUltimosDias(DIAS_JANELA);
  const timeFrom = Math.floor(new Date(janela.inicioDia).getTime() / 1000);
  const timeTo = Math.floor(new Date(janela.agora).getTime() / 1000);

  const [produtos, pedidosPorLoja, gastoAdsTotal] = await Promise.all([
    listarProdutos(),
    Promise.all(
      lojas.map(async (loja) => ({
        lojaId: loja.id,
        lojaNome: loja.nome,
        impostoPercentual: loja.imposto_percentual,
        pedidos: await listarPedidos(loja.id, timeFrom, timeTo),
      }))
    ),
    // Igual ao gastoAdsTotal do Financeiro do Mercado Livre: não é por
    // venda, só entra no total da janela. Ver shopeeAdsService.ts.
    obterGastoAdsShopee(lojaIdFiltro, lojasPermitidas, janela.inicioDia.slice(0, 10), janela.agora.slice(0, 10)),
  ]);

  const custoPorSku = new Map(produtos.map((p) => [normalizarSku(p.sku), p.custo]));

  const todosOsPedidos = pedidosPorLoja.flatMap((l) => l.pedidos);
  const resumoPedidos: ResumoPedidosShopee = {
    totalPedidos: todosOsPedidos.length,
    pedidosAprovados: todosOsPedidos.filter((p) => pedidoValido(p.order_status)).length,
    pedidosCancelados: todosOsPedidos.filter((p) => STATUS_CANCELADOS.has(p.order_status)).length,
    valorCancelado: 0,
  };

  // Detalhe (itens, sku, valores) e taxa (comissão + serviço) só dos
  // pedidos válidos — igual ao ML, não busca detalhe de pedido
  // cancelado/não pago.
  const detalhesPorLoja = await Promise.all(
    pedidosPorLoja.map(async (loja) => {
      const validos = loja.pedidos.filter((p) => pedidoValido(p.order_status)).map((p) => p.order_sn);
      const [detalhes, taxas] =
        validos.length > 0
          ? await Promise.all([buscarDetalhesPedidos(loja.lojaId, validos), buscarTaxasPedidos(loja.lojaId, validos)])
          : [[], new Map()];
      return {
        lojaId: loja.lojaId,
        lojaNome: loja.lojaNome,
        impostoPercentual: loja.impostoPercentual,
        detalhes,
        taxas,
      };
    })
  );

  const vendas: VendaFinanceiraShopee[] = [];
  for (const loja of detalhesPorLoja) {
    for (const pedido of loja.detalhes) {
      // Cada entrada de item_list já é uma linha vendida (um line_item_id) —
      // monta a lista primeiro porque a taxa (comissão + serviço) só vem no
      // nível do PEDIDO inteiro, precisa do total do pedido pra ratear por
      // linha depois.
      const linhas = (pedido.item_list ?? []).map((item) => {
        const sku = item.model_sku || item.item_sku || null;
        const quantidade = item.model_quantity_purchased ?? 1;
        const valorUnitario = item.model_discounted_price ?? 0;
        return { item, sku, quantidade, valorUnitario, receitaTotal: valorUnitario * quantidade };
      });

      const receitaTotalPedido = linhas.reduce((soma, l) => soma + l.receitaTotal, 0);
      const taxaPedido = loja.taxas.get(pedido.order_sn);
      const taxaTotalPedido = (taxaPedido?.comissao ?? 0) + (taxaPedido?.taxaServico ?? 0);
      const cupomVendedorPedido = taxaPedido?.cupomVendedor ?? 0;
      const freteVendedorPedido = taxaPedido?.freteVendedor ?? 0;

      for (const linha of linhas) {
        const custoUnitario = linha.sku !== null ? custoPorSku.get(normalizarSku(linha.sku)) ?? null : null;
        const custoTotal = custoUnitario !== null ? custoUnitario * linha.quantidade : null;
        const impostoTotal = arredondarCentavos(linha.receitaTotal * (loja.impostoPercentual / 100));
        // Comissão + taxa de serviço vêm só no total do pedido (get_escrow_
        // detail), não por item — rateia proporcional à receita de cada
        // linha dentro do pedido, mesma lógica de rateio de frete do ML.
        const taxaShopeeTotal =
          receitaTotalPedido > 0
            ? arredondarCentavos((linha.receitaTotal / receitaTotalPedido) * taxaTotalPedido)
            : 0;
        // Cupom custeado pelo vendedor — igual à taxa, só vem no total do
        // pedido, rateado proporcional à receita da linha. É custo real
        // (sai do bolso do vendedor), então entra na margem igual imposto/taxa.
        const cupomVendedorTotal =
          receitaTotalPedido > 0
            ? arredondarCentavos((linha.receitaTotal / receitaTotalPedido) * cupomVendedorPedido)
            : 0;
        // Frete real do vendedor (ver buscarTaxasPedidos em shopeeApi.ts) —
        // mesmo rateio de taxa/cupom. Na prática costuma sair 0 (a Shopee
        // reembolsa o frete integralmente via programa de frete grátis),
        // mas fica pronto pro caso de não reembolsar.
        const freteVendedorTotal =
          receitaTotalPedido > 0
            ? arredondarCentavos((linha.receitaTotal / receitaTotalPedido) * freteVendedorPedido)
            : 0;
        const margemContribuicao =
          custoTotal !== null
            ? linha.receitaTotal - custoTotal - impostoTotal - taxaShopeeTotal - cupomVendedorTotal - freteVendedorTotal
            : null;

        vendas.push({
          orderSn: pedido.order_sn,
          itemId: linha.item.item_id,
          dataCriacao: new Date(pedido.create_time * 1000).toISOString(),
          lojaId: loja.lojaId,
          lojaNome: loja.lojaNome,
          titulo: linha.item.item_name,
          sku: linha.sku,
          valorUnitario: linha.valorUnitario,
          quantidade: linha.quantidade,
          receitaTotal: linha.receitaTotal,
          custoTotal,
          impostoTotal,
          taxaShopeeTotal,
          cupomVendedorTotal,
          freteVendedorTotal,
          margemContribuicao,
          margemPercentual:
            margemContribuicao !== null && linha.receitaTotal > 0
              ? (margemContribuicao / linha.receitaTotal) * 100
              : null,
        });
      }
    }
  }

  vendas.sort((a, b) => new Date(b.dataCriacao).getTime() - new Date(a.dataCriacao).getTime());

  const resultado: ResultadoFinanceiroShopee = { vendas, resumoPedidos, gastoAdsTotal };
  cache.set(chaveCache, { data: resultado, expiraEm: Date.now() + CACHE_TTL_MS });
  return resultado;
}
