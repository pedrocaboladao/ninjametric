import { listLojas } from "./tokenStore";
import { searchOrders, MlOrder } from "./mercadoLivreApi";
import { listarProdutos } from "./produtosService";
import { janelaUltimosDias } from "./dateUtils";

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
  margemContribuicao: number | null;
  margemPercentual: number | null;
}

// Cache curto: é um feed de atividade recente, não precisa reprocessar tudo
// a cada requisição, mas também não faz sentido guardar por horas como o
// diagnóstico de promoções (que é mais "foto do dia").
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { data: VendaFinanceira[]; expiraEm: number }>();

export async function listarVendasFinanceiras(
  lojaIdFiltro?: number,
  lojasPermitidas?: number[]
): Promise<VendaFinanceira[]> {
  const lojas = (await listLojas()).filter(
    (l) =>
      l.ml_user_id !== null &&
      (lojaIdFiltro === undefined || l.id === lojaIdFiltro) &&
      (lojasPermitidas === undefined || lojasPermitidas.includes(l.id))
  );

  const chaveCache = lojas
    .map((l) => l.id)
    .sort((a, b) => a - b)
    .join(",");
  const emCache = cache.get(chaveCache);
  if (emCache && emCache.expiraEm > Date.now()) {
    return emCache.data;
  }

  const janela = janelaUltimosDias(DIAS_JANELA);

  const [produtos, ordersPorLoja] = await Promise.all([
    listarProdutos(),
    Promise.all(
      lojas.map(async (loja) => ({
        lojaId: loja.id,
        lojaNome: loja.nome,
        orders: await searchOrders(loja.id, loja.ml_user_id as number, janela.inicioDia, janela.agora),
      }))
    ),
  ]);

  const custoPorSku = new Map(produtos.map((p) => [p.sku, p.custo]));

  const vendas: VendaFinanceira[] = [];
  for (const l of ordersPorLoja) {
    for (const o of l.orders.filter((x: MlOrder) => STATUS_VALIDOS.has(x.status))) {
      for (const item of o.order_items) {
        const sku = item.item.seller_sku ?? null;
        const custoUnitario = sku !== null ? custoPorSku.get(sku) ?? null : null;
        const receitaTotal = item.unit_price * item.quantity;
        const taxaMlTotal = (item.sale_fee ?? 0) * item.quantity;
        const custoTotal = custoUnitario !== null ? custoUnitario * item.quantity : null;
        const margemContribuicao = custoTotal !== null ? receitaTotal - custoTotal - taxaMlTotal : null;

        vendas.push({
          orderId: o.id,
          dataCriacao: o.date_created,
          lojaId: l.lojaId,
          lojaNome: l.lojaNome,
          titulo: item.item.title,
          sku,
          quantidade: item.quantity,
          receitaTotal,
          custoTotal,
          taxaMlTotal,
          margemContribuicao,
          margemPercentual: margemContribuicao !== null && receitaTotal > 0 ? (margemContribuicao / receitaTotal) * 100 : null,
        });
      }
    }
  }

  vendas.sort((a, b) => new Date(b.dataCriacao).getTime() - new Date(a.dataCriacao).getTime());

  cache.set(chaveCache, { data: vendas, expiraEm: Date.now() + CACHE_TTL_MS });
  return vendas;
}
