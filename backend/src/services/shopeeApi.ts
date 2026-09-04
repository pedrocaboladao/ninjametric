import { chamarApiAssinada } from "./shopeeAuth";

// Cada entrada de item_list já é UMA linha vendida (um line_item_id) — os
// campos de variação (model_sku/model_discounted_price/
// model_quantity_purchased) vêm FLAT direto no item, não aninhados num
// "model_list" como a documentação pública sugere. Confirmado contra um
// pedido real da Catedral (a suposição de model_list zerava valor
// unitário e quantidade de toda venda, porque esse campo nunca existe).
export interface ShopeeOrderItem {
  item_id: number;
  item_name: string;
  item_sku?: string;
  model_sku?: string;
  model_quantity_purchased?: number;
  model_discounted_price?: number;
  model_original_price?: number;
}

export interface ShopeeOrder {
  order_sn: string;
  order_status: string;
  create_time: number;
  item_list: ShopeeOrderItem[];
}

interface RespostaListaPedidos {
  error?: string;
  message?: string;
  response?: {
    order_list?: { order_sn: string; order_status: string }[];
    more?: boolean;
    next_cursor?: string;
  };
}

// get_order_list rejeita ("order_list_invalid_time") uma janela maior que
// 15 dias — não é bem documentado, só descoberto testando ao vivo com uma
// loja real. 14 dias de margem de segurança.
const JANELA_MAX_SEGUNDOS = 14 * 24 * 60 * 60;

async function listarPedidosNaJanela(
  lojaId: number,
  timeFromUnix: number,
  timeToUnix: number
): Promise<{ order_sn: string; order_status: string }[]> {
  const pedidos: { order_sn: string; order_status: string }[] = [];
  let cursor = "";
  for (;;) {
    const data = await chamarApiAssinada<RespostaListaPedidos>(lojaId, "/api/v2/order/get_order_list", {
      time_range_field: "create_time",
      time_from: timeFromUnix,
      time_to: timeToUnix,
      page_size: 50,
      cursor,
      // Achado real: sem pedir explicitamente, order_status nunca vem no
      // get_order_list (fica undefined) — e como pedidoValido() em
      // financeiroShopeeService.ts filtra por esse campo, todo pedido
      // (cancelado ou não pago incluso) passava como "válido" silenciosamente.
      response_optional_fields: "order_status",
    });
    if (data.error) {
      throw new Error(`Shopee respondeu "${data.error}": ${data.message ?? ""}`);
    }
    pedidos.push(...(data.response?.order_list ?? []));
    if (!data.response?.more || !data.response?.next_cursor) break;
    cursor = data.response.next_cursor;
  }
  return pedidos;
}

// Pedidos são paginados por CURSOR (não por offset como o Mercado Livre) — a
// Shopee devolve "next_cursor" na resposta, e a próxima chamada manda de
// volta em "cursor". page_size máximo documentado é 100, usamos 50 por
// segurança. Quebra a janela pedida em pedaços de no máximo 15 dias, já que
// a Shopee rejeita a chamada inteira se o período for maior que isso.
export async function listarPedidos(
  lojaId: number,
  timeFromUnix: number,
  timeToUnix: number
): Promise<{ order_sn: string; order_status: string }[]> {
  const pedidos: { order_sn: string; order_status: string }[] = [];
  let inicio = timeFromUnix;
  while (inicio < timeToUnix) {
    const fim = Math.min(inicio + JANELA_MAX_SEGUNDOS, timeToUnix);
    pedidos.push(...(await listarPedidosNaJanela(lojaId, inicio, fim)));
    inicio = fim;
  }
  return pedidos;
}

interface RespostaDetalhePedidos {
  error?: string;
  message?: string;
  response?: { order_list?: ShopeeOrder[] };
}

const LOTE_DETALHE = 50;

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

// get_order_detail aceita no máximo 50 order_sn por chamada — busca em lotes,
// com poucas chamadas em paralelo (5) já que cada lote já carrega até 50
// pedidos de uma vez.
export async function buscarDetalhesPedidos(lojaId: number, orderSns: string[]): Promise<ShopeeOrder[]> {
  const lotes: string[][] = [];
  for (let i = 0; i < orderSns.length; i += LOTE_DETALHE) {
    lotes.push(orderSns.slice(i, i + LOTE_DETALHE));
  }

  const resultadosPorLote = await comConcorrenciaLimitada(lotes, 5, async (lote) => {
    const data = await chamarApiAssinada<RespostaDetalhePedidos>(lojaId, "/api/v2/order/get_order_detail", {
      order_sn_list: lote.join(","),
      response_optional_fields: "item_list",
    });
    if (data.error) {
      throw new Error(`Shopee respondeu "${data.error}": ${data.message ?? ""}`);
    }
    return data.response?.order_list ?? [];
  });

  return resultadosPorLote.flat();
}

export interface ShopeeTaxaPedido {
  orderSn: string;
  comissao: number;
  taxaServico: number;
  cupomVendedor: number;
  freteVendedor: number;
}

interface RespostaEscrow {
  error?: string;
  message?: string;
  response?: {
    order_income?: {
      commission_fee?: number;
      service_fee?: number;
      // net_* é o valor REAL descontado do vendedor — commission_fee/
      // service_fee são o valor BRUTO, antes de um rebate promocional que a
      // própria Shopee dá em campanha (seller_product_rebate). Achado ao
      // vivo comparando com um sistema externo de referência (Catedral,
      // 03/09): usar o bruto superestimava a taxa em até R$20 num pedido só
      // de flash sale. net_commission_fee/net_service_fee sempre presentes
      // nos 2 pedidos reais testados; cai pro bruto se um dia vier ausente.
      net_commission_fee?: number;
      net_service_fee?: number;
      // Valor do cupom aplicado na compra que fica por conta do vendedor
      // (não é a Shopee quem banca) — confirmado contra um pedido real
      // devolvido (260829MD7RM383, Catedral, cupom "CATE3OFFF"): o total do
      // pedido vem 0 por causa do estorno, mas o item dentro de "items"
      // preserva o valor original em discount_from_voucher_seller (R$4,27).
      // Em pedido sem devolução, voucher_from_seller aqui no nível do
      // pedido é o valor a usar direto, sem precisar somar item a item.
      voucher_from_seller?: number;
      // Frete real do vendedor = custo de envio menos o que o comprador
      // pagou menos o que a própria Shopee reembolsa (programa de frete
      // grátis). Confirmado ao vivo em 2 pedidos reais da Catedral:
      // actual_shipping_fee bateu exatamente com shopee_shipping_rebate
      // nos dois (custo líquido 0) — mas a fórmula fica genérica pro caso
      // de um pedido onde a Shopee não cubra o frete inteiro.
      actual_shipping_fee?: number;
      buyer_paid_shipping_fee?: number;
      shopee_shipping_rebate?: number;
    };
  };
}

// get_escrow_detail é por pedido (não aceita lista como get_order_detail),
// por isso uma chamada por order_sn — traz commission_fee + service_fee,
// que juntos equivalem à "taxa ML" (sale_fee) do Financeiro do Mercado
// Livre. Confirmado contra um pedido real (260829MD7RM383, Catedral):
// commission_fee 24.83 + service_fee 15.59, batendo com a diferença entre
// o valor da venda e o escrow_amount (o que a Shopee de fato repassa).
// Um pedido individual falhando (ex.: escrow ainda não calculado) não deve
// derrubar a busca inteira — fica de fora do mapa, tratado como taxa 0 por
// quem chama.
export async function buscarTaxasPedidos(lojaId: number, orderSns: string[]): Promise<Map<string, ShopeeTaxaPedido>> {
  const resultados = await comConcorrenciaLimitada(orderSns, 10, async (orderSn) => {
    try {
      const data = await chamarApiAssinada<RespostaEscrow>(lojaId, "/api/v2/payment/get_escrow_detail", {
        order_sn: orderSn,
      });
      if (data.error) return null;
      const income = data.response?.order_income;
      if (!income) return null;
      const freteVendedor = Math.max(
        0,
        (income.actual_shipping_fee ?? 0) - (income.buyer_paid_shipping_fee ?? 0) - (income.shopee_shipping_rebate ?? 0)
      );
      return {
        orderSn,
        comissao: income.net_commission_fee ?? income.commission_fee ?? 0,
        taxaServico: income.net_service_fee ?? income.service_fee ?? 0,
        cupomVendedor: income.voucher_from_seller ?? 0,
        freteVendedor,
      };
    } catch {
      return null;
    }
  });

  const mapa = new Map<string, ShopeeTaxaPedido>();
  for (const r of resultados) {
    if (r) mapa.set(r.orderSn, r);
  }
  return mapa;
}
