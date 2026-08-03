import { listLojas } from "./tokenStore";
import { searchOrders, getAdvertiserId, getAnunciosAds } from "./mercadoLivreApi";
import { janelaEntre, janelaUltimosDias } from "./dateUtils";

const STATUS_VALIDOS = new Set(["paid", "confirmed"]);
const DIAS_JANELA = 7;

export interface ReceitaRealCampanha {
  lojaId: number;
  campanhaId: number;
  receitaTotalReal: number;
}

// Receita REAL (todas as vendas, incluindo orgânicas) dos produtos
// anunciados em cada campanha — pra calcular o TACOS (gasto de Ads ÷
// receita real) ao lado do ACOS na tabela de campanhas. Cruza os anúncios
// (que trazem o item_id do MLB) com as vendas do Financeiro por ID exato,
// depois soma por campanha — não por nome, por ID.
export async function listarReceitaRealPorCampanha(
  lojaIdFiltro?: number,
  lojasPermitidas?: number[],
  dataInicio?: string,
  dataFim?: string
): Promise<ReceitaRealCampanha[]> {
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
    lojas.map(async (loja): Promise<ReceitaRealCampanha[]> => {
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

      const receitaPorCampanha = new Map<number, number>();
      for (const a of anuncios) {
        const receitaTotalReal = receitaPorItem.get(a.item_id) ?? 0;
        if (receitaTotalReal === 0) continue;
        receitaPorCampanha.set(a.campaign_id, (receitaPorCampanha.get(a.campaign_id) ?? 0) + receitaTotalReal);
      }

      return Array.from(receitaPorCampanha.entries()).map(([campanhaId, receitaTotalReal]) => ({
        lojaId: loja.id,
        campanhaId,
        receitaTotalReal,
      }));
    })
  );

  return porLoja.flat();
}
