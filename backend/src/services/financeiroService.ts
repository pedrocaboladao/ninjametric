import { listLojas } from "./tokenStore";
import { searchOrders, getCustoFreteDoEnvio, MlOrder } from "./mercadoLivreApi";
import { listarProdutos } from "./produtosService";
import { janelaUltimosDias, janelaEntre } from "./dateUtils";

const STATUS_VALIDOS = new Set(["paid", "confirmed"]);
const DIAS_JANELA = 7;

export interface VendaFinanceira {
  orderId: number;
  dataCriacao: string;
  lojaId: number;
  lojaNome: string;
  titulo: string;
  sku: string | null;
  quantidade: number;
  receitaTotal: number;
  custoTotal: number | null;
  taxaMlTotal: number;
  freteTotal: number | null;
  impostoTotal: number;
  margemContribuicao: number | null;
  margemPercentual: number | null;
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
const cache = new Map<string, { data: VendaFinanceira[]; expiraEm: number }>();

export async function listarVendasFinanceiras(
  lojaIdFiltro?: number,
  lojasPermitidas?: number[],
  dataInicio?: string,
  dataFim?: string
): Promise<VendaFinanceira[]> {
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
  if (emCache && emCache.expiraEm > Date.now()) {
    return emCache.data;
  }

  const janela = dataInicio && dataFim ? janelaEntre(dataInicio, dataFim) : janelaUltimosDias(DIAS_JANELA);

  const [produtos, ordersPorLoja] = await Promise.all([
    listarProdutos(),
    Promise.all(
      lojas.map(async (loja) => ({
        lojaId: loja.id,
        lojaNome: loja.nome,
        impostoPercentual: loja.imposto_percentual,
        orders: await searchOrders(loja.id, loja.ml_user_id as number, janela.inicioDia, janela.agora),
      }))
    ),
  ]);

  const custoPorSku = new Map(produtos.map((p) => [p.sku, p.custo]));

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

  const fretesPorPedido = await comConcorrenciaLimitada(pedidosValidos, 15, async ({ loja, order }) => {
    if (!order.shipping?.id) return null;
    return getCustoFreteDoEnvio(loja.lojaId, order.shipping.id);
  });

  const vendas: VendaFinanceira[] = [];
  pedidosValidos.forEach(({ loja, order }, indice) => {
    const freteDoPedido = fretesPorPedido[indice];
    // Quando o pedido tem mais de um item, rateia o frete do pedido entre
    // eles (mesma lógica pedida: dividir o custo do envio entre o que foi
    // despachado junto).
    const freteAlocado = freteDoPedido !== null ? freteDoPedido / order.order_items.length : null;

    for (const item of order.order_items) {
      const sku = item.item.seller_sku ?? null;
      const custoUnitario = sku !== null ? custoPorSku.get(sku) ?? null : null;
      const receitaTotal = item.unit_price * item.quantity;
      const taxaMlTotal = (item.sale_fee ?? 0) * item.quantity;
      const custoTotal = custoUnitario !== null ? custoUnitario * item.quantity : null;
      const impostoTotal = receitaTotal * (loja.impostoPercentual / 100);
      const margemContribuicao =
        custoTotal !== null ? receitaTotal - custoTotal - taxaMlTotal - (freteAlocado ?? 0) - impostoTotal : null;

      vendas.push({
        orderId: order.id,
        dataCriacao: order.date_created,
        lojaId: loja.lojaId,
        lojaNome: loja.lojaNome,
        titulo: item.item.title,
        sku,
        quantidade: item.quantity,
        receitaTotal,
        custoTotal,
        taxaMlTotal,
        freteTotal: freteAlocado,
        impostoTotal,
        margemContribuicao,
        margemPercentual:
          margemContribuicao !== null && receitaTotal > 0 ? (margemContribuicao / receitaTotal) * 100 : null,
      });
    }
  });

  vendas.sort((a, b) => new Date(b.dataCriacao).getTime() - new Date(a.dataCriacao).getTime());

  cache.set(chaveCache, { data: vendas, expiraEm: Date.now() + CACHE_TTL_MS });
  return vendas;
}
