import { listarPedidos, buscarDetalhesPedidos, buscarTaxasPedidos } from "./shopeeApi";
import { pool } from "../db/pool";

// A Shopee só põe a comissão de afiliado (AMS) no extrato do pedido DEPOIS que
// o pagamento é liberado (~11-12 dias após a venda). Até lá o extrato vem com
// afiliado 0, e a margem do pedido recente aparece maior que a real (confirmado
// ao vivo na Pinta e Constrói: a pedra 5kg passa de +R$ 8,81 pra prejuízo
// quando o afiliado entra). Pra não mostrar margem inflada, os pedidos ainda
// não liberados usam uma ESTIMATIVA: a taxa média de afiliado (afiliado ÷
// receita) que a própria loja/anúncio teve nos pedidos já liberados.
//
// A taxa é calculada em segundo plano (não dentro da requisição de ninguém) e
// fica em memória; reinício do servidor recalcula no start.

// Pedido criado há menos que isso ainda não teve o pagamento liberado.
export const DIAS_ATE_LIBERAR = 14;

// Janela de pedidos JÁ liberados usada como amostra: de 19 a 15 dias atrás.
const AMOSTRA_DE_DIAS_ATRAS = 19;
const AMOSTRA_ATE_DIAS_ATRAS = 15;
const AMOSTRA_MAX_PEDIDOS = 150;
const MIN_PEDIDOS_LOJA = 20;
const MIN_PEDIDOS_ITEM = 8;
const TTL_MS = 12 * 60 * 60 * 1000;

export interface TaxaAfiliado {
  // afiliado ÷ receita, em fração (0,09 = 9%). Média da loja toda (só informativo/log).
  geral: number;
  // idem por anúncio (item_id da Shopee), só pra quem tem amostra suficiente.
  porItem: Map<number, number>;
  pedidosNaAmostra: number;
  calculadoEm: number;
}

const taxasPorLoja = new Map<number, TaxaAfiliado>();

export function obterTaxaAfiliado(lojaId: number): TaxaAfiliado | null {
  const t = taxasPorLoja.get(lojaId);
  return t ?? null;
}

// Só anúncio com amostra própria suficiente recebe estimativa: aplicar a média
// da loja toda num produto que nunca teve afiliado inventaria um custo.
export function taxaAfiliadoDoItem(lojaId: number, itemId: number): number {
  return taxasPorLoja.get(lojaId)?.porItem.get(itemId) ?? 0;
}

export async function recalcularTaxaAfiliado(lojaId: number): Promise<void> {
  const agora = Math.floor(Date.now() / 1000);
  const de = agora - AMOSTRA_DE_DIAS_ATRAS * 86400;
  const ate = agora - AMOSTRA_ATE_DIAS_ATRAS * 86400;
  const lista = (await listarPedidos(lojaId, de, ate)).filter((p) => p.order_status === "COMPLETED");
  const escolhidos = lista.slice(0, AMOSTRA_MAX_PEDIDOS).map((p) => p.order_sn);
  if (escolhidos.length === 0) {
    taxasPorLoja.set(lojaId, { geral: 0, porItem: new Map(), pedidosNaAmostra: 0, calculadoEm: Date.now() });
    return;
  }
  const [detalhes, taxas] = await Promise.all([
    buscarDetalhesPedidos(lojaId, escolhidos),
    buscarTaxasPedidos(lojaId, escolhidos),
  ]);

  let afiliadoGeral = 0;
  let receitaGeral = 0;
  let pedidosGeral = 0;
  const porItem = new Map<number, { afiliado: number; receita: number; pedidos: number }>();

  for (const pedido of detalhes) {
    const taxa = taxas.get(pedido.order_sn);
    // Sem extrato, ou extrato zerado (pedido devolvido/estornado): não diz nada
    // sobre afiliado, fica fora da amostra.
    if (!taxa || taxa.comissao + taxa.taxaServico <= 0) continue;
    const linhas = (pedido.item_list ?? []).map((i) => ({
      itemId: i.item_id,
      receita: (i.model_discounted_price ?? 0) * (i.model_quantity_purchased ?? 1),
      original: (i.model_original_price ?? i.model_discounted_price ?? 0) * (i.model_quantity_purchased ?? 1),
    }));
    const originalTotal = linhas.reduce((s, l) => s + l.original, 0);
    if (originalTotal <= 0) continue;
    pedidosGeral++;
    for (const l of linhas) {
      const afiliado = taxa.comissaoAfiliado * (l.original / originalTotal);
      afiliadoGeral += afiliado;
      receitaGeral += l.receita;
      const acc = porItem.get(l.itemId) ?? { afiliado: 0, receita: 0, pedidos: 0 };
      acc.afiliado += afiliado;
      acc.receita += l.receita;
      acc.pedidos += 1;
      porItem.set(l.itemId, acc);
    }
  }

  const geral = pedidosGeral >= MIN_PEDIDOS_LOJA && receitaGeral > 0 ? afiliadoGeral / receitaGeral : 0;
  const taxaPorItem = new Map<number, number>();
  if (geral > 0 || afiliadoGeral > 0) {
    for (const [itemId, acc] of porItem) {
      if (acc.pedidos >= MIN_PEDIDOS_ITEM && acc.receita > 0) taxaPorItem.set(itemId, acc.afiliado / acc.receita);
    }
  }
  taxasPorLoja.set(lojaId, { geral, porItem: taxaPorItem, pedidosNaAmostra: pedidosGeral, calculadoEm: Date.now() });
  console.log(
    `Afiliado Shopee (loja ${lojaId}): amostra de ${pedidosGeral} pedidos liberados, taxa geral ${(geral * 100).toFixed(2)}%, ${taxaPorItem.size} anúncios com taxa própria.`
  );
}

// Calcula pra todas as lojas com Shopee, uma de cada vez (não sobrecarrega a
// API), no start do servidor e a cada 12h.
export function iniciarEstimativaAfiliadoShopee(): void {
  async function ciclo() {
    try {
      const { rows: lojas } = await pool.query<{ id: number }>(
        "SELECT l.id FROM lojas l JOIN contas_shopee c ON c.loja_id = l.id ORDER BY l.id"
      );
      for (const loja of lojas) {
        try {
          await recalcularTaxaAfiliado(loja.id);
        } catch (err) {
          console.error(`Falha ao estimar afiliado Shopee da loja ${loja.id}:`, err);
        }
      }
    } catch (err) {
      console.error("Falha ao estimar afiliado Shopee:", err);
    }
  }
  // Pequeno atraso no start pra não competir com o resto da inicialização.
  setTimeout(ciclo, 60_000);
  setInterval(ciclo, TTL_MS);
}
