import { getAdvertiserId, getAnunciosAds } from "./mercadoLivreApi";
import { listLojas } from "./tokenStore";
import { listarVendasFinanceiras } from "./financeiroService";

export interface ReceitaRealCampanha {
  lojaId: number;
  campanhaId: number;
  receitaTotalReal: number;
  // Margem de contribuição real do(s) produto(s) da campanha, em % da
  // receita — teto aproximado de ACOS sustentável: se o ACOS passar disso,
  // o gasto de Ads sozinho já consome toda a margem do produto (antes
  // mesmo de olhar o custo fixo). Vem do mesmo cálculo do Financeiro, não
  // é um número novo — só está aplicado numa visão diferente aqui.
  acosIdeal: number | null;
}

// Cruza os anúncios de Ads (que trazem o item_id do MLB) com as vendas do
// Financeiro por ID exato — não por nome de campanha — e soma por
// campanha. Reaproveita o cálculo de receita e margem que o Financeiro já
// faz, em vez de duplicar a lógica de custo/imposto/tarifa/frete aqui.
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

  const { vendas } = await listarVendasFinanceiras(lojaIdFiltro, lojasPermitidas, dataInicio, dataFim);

  const receitaPorItem = new Map<string, number>();
  const margemPorItem = new Map<string, number>();
  for (const v of vendas) {
    receitaPorItem.set(v.itemId, (receitaPorItem.get(v.itemId) ?? 0) + v.receitaTotal);
    if (v.margemContribuicao !== null) {
      margemPorItem.set(v.itemId, (margemPorItem.get(v.itemId) ?? 0) + v.margemContribuicao);
    }
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dataInicioReal = dataInicio ?? seteDiasAtras;
  const dataFimReal = dataFim ?? hoje;

  const porLoja = await Promise.all(
    lojas.map(async (loja): Promise<ReceitaRealCampanha[]> => {
      const advertiserId = await getAdvertiserId(loja.id);
      if (advertiserId === null) return [];

      let anuncios;
      try {
        anuncios = await getAnunciosAds(loja.id, advertiserId, dataInicioReal, dataFimReal);
      } catch {
        return [];
      }

      // A API de Ads pode devolver mais de um "anúncio" (linha) pro mesmo
      // item_id dentro da mesma campanha (ex.: mais de um formato/posição
      // anunciando o mesmo produto) — sem esse controle, a receita real
      // daquele item entrava somada de novo a cada linha repetida,
      // inflando a receita e o ACOS Ideal da campanha. Cada item só pode
      // contar sua receita/margem uma vez por campanha.
      const porCampanha = new Map<number, { receita: number; margem: number; itensContados: Set<string> }>();
      for (const a of anuncios) {
        const receitaTotalReal = receitaPorItem.get(a.item_id) ?? 0;
        if (receitaTotalReal === 0) continue;
        const atual = porCampanha.get(a.campaign_id) ?? { receita: 0, margem: 0, itensContados: new Set<string>() };
        if (!atual.itensContados.has(a.item_id)) {
          atual.itensContados.add(a.item_id);
          atual.receita += receitaTotalReal;
          atual.margem += margemPorItem.get(a.item_id) ?? 0;
        }
        porCampanha.set(a.campaign_id, atual);
      }

      return Array.from(porCampanha.entries()).map(([campanhaId, v]) => ({
        lojaId: loja.id,
        campanhaId,
        receitaTotalReal: v.receita,
        acosIdeal: v.receita > 0 ? (v.margem / v.receita) * 100 : null,
      }));
    })
  );

  return porLoja.flat();
}
