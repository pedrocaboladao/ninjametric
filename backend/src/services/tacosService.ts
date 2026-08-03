import { listLojas } from "./tokenStore";
import { searchOrders, getAdvertiserId, getAnunciosAds } from "./mercadoLivreApi";
import { janelaEntre, janelaUltimosDias } from "./dateUtils";

const STATUS_VALIDOS = new Set(["paid", "confirmed"]);
const DIAS_JANELA = 7;

export interface TacosProduto {
  lojaId: number;
  lojaNome: string;
  itemId: string;
  titulo: string;
  gastoAds: number;
  vendasAtribuidasAds: number;
  receitaTotalReal: number;
  acos: number | null;
  tacos: number | null;
}

// TACOS real = gasto de Ads dividido pela receita REAL do produto (todas as
// vendas, incluindo as orgânicas) — diferente do ACOS, que só compara com
// as vendas que o próprio Mercado Livre credita ao Ads. Cruza por item_id
// (o mesmo id do MLB usado nas vendas do Financeiro), não por nome de
// campanha — correspondência exata, sem heurística de texto.
export async function listarTacosPorProduto(
  lojaIdFiltro?: number,
  lojasPermitidas?: number[],
  dataInicio?: string,
  dataFim?: string
): Promise<TacosProduto[]> {
  const lojas = (await listLojas()).filter(
    (l) =>
      l.ml_user_id !== null &&
      (lojaIdFiltro === undefined || l.id === lojaIdFiltro) &&
      (lojasPermitidas === undefined || lojasPermitidas.includes(l.id))
  );

  const janela = dataInicio && dataFim ? janelaEntre(dataInicio, dataFim) : janelaUltimosDias(DIAS_JANELA);
  const dataInicioReal = janela.inicioDia.slice(0, 10);
  const dataFimReal = janela.agora.slice(0, 10);

  const porLoja = await Promise.all(
    lojas.map(async (loja) => {
      const [orders, advertiserId] = await Promise.all([
        searchOrders(loja.id, loja.ml_user_id as number, janela.inicioDia, janela.agora),
        getAdvertiserId(loja.id),
      ]);
      if (advertiserId === null) return [];

      const receitaPorItem = new Map<string, number>();
      for (const order of orders) {
        if (!STATUS_VALIDOS.has(order.status)) continue;
        for (const item of order.order_items) {
          const atual = receitaPorItem.get(item.item.id) ?? 0;
          receitaPorItem.set(item.item.id, atual + item.unit_price * item.quantity);
        }
      }

      let anuncios;
      try {
        anuncios = await getAnunciosAds(loja.id, advertiserId, dataInicioReal, dataFimReal);
      } catch {
        return [];
      }

      return anuncios
        .filter((a) => a.metrics.cost > 0 || a.metrics.total_amount > 0)
        .map((a): TacosProduto => {
          const receitaTotalReal = receitaPorItem.get(a.item_id) ?? 0;
          // TACOS não pode ficar menor que a receita já creditada ao Ads
          // (diferença de fuso/janela entre as duas buscas pode fazer a
          // nossa contagem de pedidos ficar levemente atrás da do ML) — usa
          // o maior dos dois como base, pra não mostrar TACOS abaixo do ACOS.
          const receitaBase = Math.max(receitaTotalReal, a.metrics.total_amount);
          return {
            lojaId: loja.id,
            lojaNome: loja.nome,
            itemId: a.item_id,
            titulo: a.title,
            gastoAds: a.metrics.cost,
            vendasAtribuidasAds: a.metrics.total_amount,
            receitaTotalReal,
            acos: a.metrics.total_amount > 0 ? (a.metrics.cost / a.metrics.total_amount) * 100 : null,
            tacos: receitaBase > 0 ? (a.metrics.cost / receitaBase) * 100 : null,
          };
        });
    })
  );

  return porLoja.flat();
}
