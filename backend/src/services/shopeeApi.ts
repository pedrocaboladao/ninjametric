import { chamarApiAssinada } from "./shopeeAuth";

export interface ShopeeOrderItemModel {
  model_sku?: string;
  model_quantity_purchased?: number;
  model_discounted_price?: number;
  model_original_price?: number;
}

export interface ShopeeOrderItem {
  item_id: number;
  item_name: string;
  item_sku?: string;
  model_list?: ShopeeOrderItemModel[];
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

// Pedidos são paginados por CURSOR (não por offset como o Mercado Livre) — a
// Shopee devolve "next_cursor" na resposta, e a próxima chamada manda de
// volta em "cursor". page_size máximo documentado é 100, usamos 50 por
// segurança.
export async function listarPedidos(
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
