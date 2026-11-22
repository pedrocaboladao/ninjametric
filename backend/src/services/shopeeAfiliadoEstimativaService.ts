import { listarPedidos, buscarDetalhesPedidos, buscarTaxasPedidos } from "./shopeeApi";
import { pool } from "../db/pool";

// A Shopee só põe a comissão de afiliado (AMS) no extrato do pedido quando ele é
// CONCLUÍDO (~8 a 17 dias após a venda). Até lá o extrato vem com
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
// Pedido concluído há menos que isso ainda pode estar sem o afiliado no extrato.
// Já foi 9 dias ("7 dias depois da conclusão, mais uma folga"), mas medido em
// 120 pedidos concluídos da Pinta e Constrói (22/11/2026) o afiliado já estava
// lá com 0,2 dia da última atualização — e a regra de 9 dias chamava de
// "pendente" 53 dos 54 pedidos que já tinham o valor fechado. Os únicos sem
// afiliado bem no começo tinham menos de 3 horas; 1 dia cobre isso com folga.
export const DIAS_CONCLUIDO_ATE_LIBERAR = 1;

// Janela de pedidos já concluídos usada como amostra: criados de 28 a 14 dias
// atrás — o mais recente que ainda tem a grande maioria concluída (um pedido
// leva de 8 a 17 dias). A primeira janela (19 a 15 dias, exigindo concluído há
// mais de 10) quase não deixava pedido passar: em produção a Pinta e Constrói
// ficou com amostra 0 e nenhuma loja com taxa por anúncio.
const AMOSTRA_DE_DIAS_ATRAS = 28;
const AMOSTRA_ATE_DIAS_ATRAS = 14;
const AMOSTRA_MAX_PEDIDOS = 400;
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

async function salvarNoBanco(lojaId: number, t: TaxaAfiliado): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO shopee_afiliado_taxas (loja_id, geral, itens, pedidos_amostra, calculado_em)
       VALUES ($1, $2, $3::jsonb, $4, now())
       ON CONFLICT (loja_id) DO UPDATE
         SET geral = $2, itens = $3::jsonb, pedidos_amostra = $4, calculado_em = now()`,
      [lojaId, t.geral, JSON.stringify(Object.fromEntries(t.porItem)), t.pedidosNaAmostra]
    );
  } catch (err) {
    console.error(`Falha ao salvar a taxa de afiliado da loja ${lojaId}:`, err);
  }
}

async function carregarDoBanco(): Promise<void> {
  try {
    const { rows } = await pool.query<{
      loja_id: number;
      geral: string;
      itens: Record<string, number>;
      pedidos_amostra: number;
      calculado_em: Date;
    }>("SELECT loja_id, geral, itens, pedidos_amostra, calculado_em FROM shopee_afiliado_taxas");
    for (const r of rows) {
      taxasPorLoja.set(r.loja_id, {
        geral: Number(r.geral),
        porItem: new Map(Object.entries(r.itens ?? {}).map(([k, v]) => [Number(k), Number(v)])),
        pedidosNaAmostra: r.pedidos_amostra,
        calculadoEm: new Date(r.calculado_em).getTime(),
      });
    }
    console.log(`Afiliado Shopee: ${rows.length} loja(s) carregada(s) do banco.`);
  } catch (err) {
    console.error("Falha ao carregar as taxas de afiliado do banco:", err);
  }
}

// Pro diagnóstico (rota de admin): o que está em memória agora.
export function listarTaxasAfiliado() {
  return [...taxasPorLoja.entries()].map(([lojaId, t]) => ({
    lojaId,
    geralPercentual: Math.round(t.geral * 10000) / 100,
    pedidosNaAmostra: t.pedidosNaAmostra,
    calculadoEm: new Date(t.calculadoEm).toISOString(),
    anunciosComTaxaPropria: [...t.porItem.entries()].map(([itemId, taxa]) => ({
      itemId,
      percentual: Math.round(taxa * 10000) / 100,
    })),
  }));
}

export async function recalcularTaxaAfiliado(lojaId: number): Promise<void> {
  const agora = Math.floor(Date.now() / 1000);
  const de = agora - AMOSTRA_DE_DIAS_ATRAS * 86400;
  const ate = agora - AMOSTRA_ATE_DIAS_ATRAS * 86400;
  const lista = (await listarPedidos(lojaId, de, ate)).filter((p) => p.order_status === "COMPLETED");
  // Loja grande tem milhares de pedidos na janela: pega um a cada N, espalhado
  // pelos 14 dias. Os primeiros da lista seriam todos das mesmas horas, e um
  // afiliado que vende em dias específicos ficaria de fora.
  const passo = Math.max(1, Math.ceil(lista.length / AMOSTRA_MAX_PEDIDOS));
  const escolhidos = lista.filter((_, i) => i % passo === 0).map((p) => p.order_sn);
  if (escolhidos.length === 0) {
    const vazia: TaxaAfiliado = { geral: 0, porItem: new Map(), pedidosNaAmostra: 0, calculadoEm: Date.now() };
    taxasPorLoja.set(lojaId, vazia);
    await salvarNoBanco(lojaId, vazia);
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
    // Concluído agora há pouco ainda pode estar sem o afiliado no extrato.
    if (pedido.update_time && pedido.update_time * 1000 > Date.now() - DIAS_CONCLUIDO_ATE_LIBERAR * 24 * 60 * 60 * 1000) continue;
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
  const nova: TaxaAfiliado = { geral, porItem: taxaPorItem, pedidosNaAmostra: pedidosGeral, calculadoEm: Date.now() };
  // Amostra fraca (a Shopee falhou em devolver extratos, por exemplo) não apaga
  // uma taxa boa que já existia: a estimativa sumiria da tela até o próximo ciclo.
  const anterior = taxasPorLoja.get(lojaId);
  if (pedidosGeral < MIN_PEDIDOS_LOJA && anterior && anterior.porItem.size > 0) {
    console.log(
      `Afiliado Shopee (loja ${lojaId}): amostra de só ${pedidosGeral} pedidos — mantida a taxa anterior (${anterior.porItem.size} anúncios).`
    );
    return;
  }
  taxasPorLoja.set(lojaId, nova);
  await salvarNoBanco(lojaId, nova);
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
        // Já calculada há pouco (vinda do banco depois de um deploy): não gasta API
        // à toa. Só vale pra quem tem taxa por anúncio — resultado vazio é refeito,
        // senão um cálculo que saiu vazio por defeito ficaria valendo por 12h.
        const atual = taxasPorLoja.get(loja.id);
        if (atual && atual.porItem.size > 0 && Date.now() - atual.calculadoEm < TTL_MS * 0.9) continue;
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
  // Carrega o que já estava salvo ANTES de qualquer coisa (a tela já usa na hora),
  // depois recalcula em segundo plano só o que estiver velho ou faltando.
  carregarDoBanco().then(() => setTimeout(ciclo, 20_000));
  setInterval(ciclo, TTL_MS);
}
