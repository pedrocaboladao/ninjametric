import { listLojas } from "./tokenStore";
import { searchOrders, getCustoFreteDoEnvio, getItemsBasicInfo, MlOrder } from "./mercadoLivreApi";
import { listarProdutos } from "./produtosService";
import { janelaUltimosDias, janelaEntre, janelaMesAtual } from "./dateUtils";
import { obterGastoAdsHistorico } from "./adsService";

const STATUS_VALIDOS = new Set(["paid", "confirmed"]);
const STATUS_CANCELADO = "cancelled";
const DIAS_JANELA = 7;

// A planilha de produtos às vezes tem o SKU digitado sem acento (ex.:
// "CAMURCA") enquanto o Mercado Livre tem o SKU real com acento
// ("CAMURÇA") — mesma peça, grafias diferentes. Normaliza (maiúsculas +
// remove acento) tanto na hora de indexar a planilha quanto na hora de
// procurar o SKU da venda, pra essas duas grafias baterem.
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
    // Ignora só hífen/espaço/barra — separadores cosméticos de verdade na
    // convenção de SKU das lojas ("BRILHACOR-16LTS" = "BRILHACOR 16LTS").
    // NÃO mexe no ponto: ele é decimal, muda o número — "INGAFLEX-3.6KG"
    // (produto de 3,6kg) virava igual a "INGAFLEX-36KG" (produto de 36kg,
    // custo 7x maior) quando o ponto também era removido. Bug real, achado
    // comparando com a planilha de custos de verdade: 56 grupos de SKU
    // colidindo com custo errado por causa disso.
    .replace(/[\s\-/]+/g, "");
}

// Arredonda pra cima no meio-a-meio (ex.: 42,995 -> 43,00), igual à
// convenção do sistema externo — o toFixed nativo do JS erra esse caso
// específico (42.995.toFixed(2) dá "42.99" em vez de "43.00", porque o
// número não é representável exatamente em ponto flutuante binário; o
// pequeno epsilon somado antes corrige isso sem afetar nenhum outro valor).
function arredondarCentavos(valor: number): number {
  return Math.round((valor + 1e-9) * 100) / 100;
}

// TEMP: os 2 pedidos de 02/08/2026 abaixo já saíram com a grafia antiga do
// SKU ("RESIFLEX-18KG-MARROM-TELHA") antes da correção no anúncio do
// Mercado Livre — pedido feito não muda de SKU depois, só as vendas novas
// já saem com a grafia certa (que já está na planilha). É só pra esses 2
// pedidos históricos baterem no gráfico de hoje; pode remover depois.
const CUSTO_MANUAL_TEMP_POR_PEDIDO: Record<number, number> = {
  2000017713022558: 110,
  2000017713024336: 110,
};

export interface VendaFinanceira {
  orderId: number;
  itemId: string;
  dataCriacao: string;
  lojaId: number;
  lojaNome: string;
  titulo: string;
  sku: string | null;
  thumbnail: string | null;
  valorUnitario: number;
  quantidade: number;
  receitaTotal: number;
  custoTotal: number | null;
  taxaMlTotal: number;
  freteVendedorTotal: number | null;
  freteCompradorTotal: number | null;
  impostoTotal: number;
  margemContribuicao: number | null;
  margemPercentual: number | null;
}

// Contagem de pedidos por status na janela pesquisada — vem do mesmo
// resultado de busca dos pedidos (só olhamos os já pagos/confirmados pra
// montar a lista de vendas, mas os outros status já vieram junto).
export interface ResumoPedidos {
  totalPedidos: number;
  pedidosAprovados: number;
  pedidosCancelados: number;
  valorCancelado: number;
}

export interface ResultadoFinanceiro {
  vendas: VendaFinanceira[];
  resumoPedidos: ResumoPedidos;
  gastoAdsTotal: number;
}

async function comConcorrenciaLimitada<T, R>(itens: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(itens.length);
  let indice = 0;
  async function worker() {
    while (indice < itens.length) {
      const i = indice++;
      resultados[i] = await fn(itens[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, worker));
  return resultados;
}

// Cache curto: é um feed de atividade recente, não precisa reprocessar tudo
// a cada requisição, mas também não faz sentido guardar por horas como o
// diagnóstico de promoções (que é mais "foto do dia").
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { data: ResultadoFinanceiro; expiraEm: number }>();

export async function listarVendasFinanceiras(
  lojaIdFiltro?: number,
  lojasPermitidas?: number[],
  dataInicio?: string,
  dataFim?: string,
  forcarAtualizacao = false
): Promise<ResultadoFinanceiro> {
  const lojas = (await listLojas()).filter(
    (l) =>
      l.ml_user_id !== null &&
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

  const [produtos, ordersPorLoja, gastoAdsTotal] = await Promise.all([
    listarProdutos(),
    Promise.all(
      lojas.map(async (loja) => ({
        lojaId: loja.id,
        lojaNome: loja.nome,
        impostoPercentual: loja.imposto_percentual,
        orders: await searchOrders(loja.id, loja.ml_user_id as number, janela.inicioDia, janela.agora),
      }))
    ),
    // Gasto de Ads não é por venda (é por campanha/dia), por isso não entra
    // na margem de cada linha da tabela — só no total da janela, pra dar uma
    // ideia de margem "depois do investimento em publicidade" sem misturar
    // com o custo fixo (que ainda não existe no sistema, vai entrar só no DRE).
    // Vem do histórico salvo (imune a campanhas excluídas), não da API ao vivo.
    obterGastoAdsHistorico(lojaIdFiltro, lojasPermitidas, dataInicio, dataFim),
  ]);

  const custoPorSku = new Map(produtos.map((p) => [normalizarSku(p.sku), p.custo]));

  const todosOsPedidos = ordersPorLoja.flatMap((l) => l.orders);
  const pedidosCancelados = todosOsPedidos.filter((o) => o.status === STATUS_CANCELADO);
  const resumoPedidos: ResumoPedidos = {
    totalPedidos: todosOsPedidos.length,
    pedidosAprovados: todosOsPedidos.filter((o) => STATUS_VALIDOS.has(o.status)).length,
    pedidosCancelados: pedidosCancelados.length,
    valorCancelado: pedidosCancelados.reduce((soma, o) => soma + Number(o.total_amount), 0),
  };

  // Pedidos válidos (pagos/confirmados) de todas as lojas, achatados numa
  // lista só, pra buscar o frete de cada um com paralelismo limitado — sem
  // isso, uma janela com muitos pedidos ficaria lenta (uma chamada de frete
  // por pedido, sequencial).
  const pedidosValidos: { loja: (typeof ordersPorLoja)[number]; order: MlOrder }[] = [];
  for (const l of ordersPorLoja) {
    for (const o of l.orders.filter((x: MlOrder) => STATUS_VALIDOS.has(x.status))) {
      pedidosValidos.push({ loja: l, order: o });
    }
  }

  // Miniatura por item — busca em lote (getItemsBasicInfo já pagina de 20 em
  // 20 por loja), não uma chamada por venda. Agrupado por loja porque o
  // token de acesso é por loja, mesmo a rota de multiget sendo dado público.
  const itemIdsPorLoja = new Map<number, Set<string>>();
  for (const { loja, order } of pedidosValidos) {
    const set = itemIdsPorLoja.get(loja.lojaId) ?? new Set<string>();
    for (const item of order.order_items) set.add(item.item.id);
    itemIdsPorLoja.set(loja.lojaId, set);
  }
  const thumbnailPorItem = new Map<string, string | null>();

  const [fretesPorPedido] = await Promise.all([
    comConcorrenciaLimitada(pedidosValidos, 15, async ({ loja, order }) => {
      if (!order.shipping?.id) return { vendedor: null, comprador: null, itensNoEnvio: 1 };
      return getCustoFreteDoEnvio(loja.lojaId, order.shipping.id);
    }),
    Promise.all(
      Array.from(itemIdsPorLoja.entries()).map(async ([lojaId, ids]) => {
        const info = await getItemsBasicInfo(lojaId, Array.from(ids));
        // O Mercado Livre devolve thumbnail em http:// — o painel é servido
        // em https, então o navegador bloqueia como conteúdo misto. mlstatic
        // aceita https normalmente, só troca o protocolo.
        for (const [itemId, i] of info) {
          thumbnailPorItem.set(itemId, i.thumbnail ? i.thumbnail.replace(/^http:/, "https:") : null);
        }
      })
    ),
  ]);

  const vendas: VendaFinanceira[] = [];
  pedidosValidos.forEach(({ loja, order }, indice) => {
    const freteDoPedido = fretesPorPedido[indice];
    // O list_cost/cost do envio é do ENVIO inteiro, não do pedido — quando
    // dois pedidos diferentes (ex.: cores diferentes do mesmo produto) vão
    // despachados juntos, os dois compartilham o mesmo envio e o mesmo
    // list_cost cheio (confirmado com um pedido real). Por isso rateia pelo
    // total de itens do ENVIO (itensNoEnvio), não pelos itens do pedido —
    // dividir só pelos itens do pedido fazia um pedido "levar" o frete que
    // devia ser dividido com outro.
    const freteVendedorAlocado =
      freteDoPedido.vendedor !== null ? freteDoPedido.vendedor / freteDoPedido.itensNoEnvio : null;
    // Frete comprador é só informativo (não entra na margem) — arredonda por
    // pedido pra bater com a convenção do sistema externo, em vez de manter
    // a fração exata como fazemos no frete vendedor (que afeta a margem).
    const freteCompradorAlocado =
      freteDoPedido.comprador !== null
        ? arredondarCentavos(freteDoPedido.comprador / freteDoPedido.itensNoEnvio)
        : null;

    for (const item of order.order_items) {
      const sku = item.item.seller_sku ?? null;
      const custoUnitario =
        CUSTO_MANUAL_TEMP_POR_PEDIDO[order.id] ??
        (sku !== null ? custoPorSku.get(normalizarSku(sku)) ?? null : null);
      const receitaTotal = item.unit_price * item.quantity;
      const taxaMlTotal = (item.sale_fee ?? 0) * item.quantity;
      const custoTotal = custoUnitario !== null ? custoUnitario * item.quantity : null;
      // Arredonda por venda (não só no total da janela) — igual à convenção
      // do sistema externo. Sem isso, somar as frações exatas de cada venda
      // e arredondar só o total pode fechar num centavo diferente de somar
      // cada venda já arredondada (confirmado comparando um dia inteiro:
      // 731,3971 fecha em R$731,40 somando bruto, mas em R$731,39 somando
      // cada linha arredondada primeiro).
      const impostoTotal = arredondarCentavos(receitaTotal * (loja.impostoPercentual / 100));
      // Frete do comprador não é custo da loja — não entra na margem, é só
      // informativo (na prática costuma ser 0, já que os anúncios têm frete
      // grátis pro comprador).
      const margemContribuicao =
        custoTotal !== null
          ? receitaTotal - custoTotal - taxaMlTotal - (freteVendedorAlocado ?? 0) - impostoTotal
          : null;

      vendas.push({
        orderId: order.id,
        itemId: item.item.id,
        dataCriacao: order.date_created,
        lojaId: loja.lojaId,
        lojaNome: loja.lojaNome,
        titulo: item.item.title,
        sku,
        thumbnail: thumbnailPorItem.get(item.item.id) ?? null,
        valorUnitario: item.unit_price,
        quantidade: item.quantity,
        receitaTotal,
        custoTotal,
        taxaMlTotal,
        freteVendedorTotal: freteVendedorAlocado,
        freteCompradorTotal: freteCompradorAlocado,
        impostoTotal,
        margemContribuicao,
        margemPercentual:
          margemContribuicao !== null && receitaTotal > 0 ? (margemContribuicao / receitaTotal) * 100 : null,
      });
    }
  });

  vendas.sort((a, b) => new Date(b.dataCriacao).getTime() - new Date(a.dataCriacao).getTime());

  const resultado: ResultadoFinanceiro = { vendas, resumoPedidos, gastoAdsTotal };
  cache.set(chaveCache, { data: resultado, expiraEm: Date.now() + CACHE_TTL_MS });
  return resultado;
}

export interface PontoEquilibrio {
  margemAposAds: number;
  custoFixoMensal: number;
  diasDecorridos: number;
  diasNoMes: number;
  projecaoFechamento: number;
  percentualAtingido: number | null;
}

// Sempre o mês corrente (dia 1 até hoje), independente do período escolhido
// nos filtros da tela — ponto de equilíbrio é um conceito de mês fechado,
// não faz sentido variar com um filtro de data arbitrário.
export async function calcularPontoEquilibrio(
  lojaIdFiltro?: number,
  lojasPermitidas?: number[],
  forcarAtualizacao = false
): Promise<PontoEquilibrio> {
  const mes = janelaMesAtual();
  const dataInicio = mes.inicioDia.slice(0, 10);
  const dataFim = mes.agora.slice(0, 10);

  const [{ vendas, gastoAdsTotal }, lojas] = await Promise.all([
    listarVendasFinanceiras(lojaIdFiltro, lojasPermitidas, dataInicio, dataFim, forcarAtualizacao),
    listLojas(),
  ]);
  // Custo fixo é por loja — soma só das lojas que entram no filtro atual
  // (uma loja específica, ou o total de "todas"/"minhas lojas").
  const custoFixoMensal = lojas
    .filter(
      (l) =>
        l.ml_user_id !== null &&
        (lojaIdFiltro === undefined || l.id === lojaIdFiltro) &&
        (lojasPermitidas === undefined || lojasPermitidas.includes(l.id))
    )
    .reduce((soma, l) => soma + l.custo_fixo_mensal, 0);

  const margemContribuicao = vendas.reduce((soma, v) => soma + (v.margemContribuicao ?? 0), 0);
  const margemAposAds = margemContribuicao - gastoAdsTotal;
  const projecaoFechamento =
    mes.diasDecorridos > 0 ? (margemAposAds / mes.diasDecorridos) * mes.diasNoMes : margemAposAds;

  return {
    margemAposAds,
    custoFixoMensal,
    diasDecorridos: mes.diasDecorridos,
    diasNoMes: mes.diasNoMes,
    projecaoFechamento,
    percentualAtingido: custoFixoMensal > 0 ? (margemAposAds / custoFixoMensal) * 100 : null,
  };
}
