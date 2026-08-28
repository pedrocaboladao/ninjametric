import { pool } from "../db/pool";
import { listarPedidos, buscarDetalhesPedidos, ShopeeOrderItemModel } from "./shopeeApi";
import { listarProdutos } from "./produtosService";
import { janelaUltimosDias, janelaEntre } from "./dateUtils";

const DIAS_JANELA = 7;

// Enum de status real da Shopee ainda não confirmado contra uma resposta ao
// vivo (a loja piloto não teve pedido de verdade até agora) — usa o
// conjunto documentado publicamente. Revisar assim que o primeiro pedido
// real da Catedral aparecer.
const STATUS_CANCELADOS = new Set(["CANCELLED", "IN_CANCEL"]);
const STATUS_NAO_PAGOS = new Set(["UNPAID", "INVOICE_PENDING"]);

function pedidoValido(status: string): boolean {
  return !STATUS_CANCELADOS.has(status) && !STATUS_NAO_PAGOS.has(status);
}

// Mesma lógica de normalização do Financeiro do Mercado Livre
// (financeiroService.ts) — SKU é a mesma planilha de produtos pros dois
// canais, então precisa bater igual. Duplicado de propósito (convenção
// deste projeto: helper pequeno por arquivo, não compartilhado).
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
    .replace(/[\s\-/]+/g, "");
}

function arredondarCentavos(valor: number): number {
  return Math.round((valor + 1e-9) * 100) / 100;
}

export interface VendaFinanceiraShopee {
  orderSn: string;
  itemId: number;
  dataCriacao: string;
  lojaId: number;
  lojaNome: string;
  titulo: string;
  sku: string | null;
  valorUnitario: number;
  quantidade: number;
  receitaTotal: number;
  custoTotal: number | null;
  impostoTotal: number;
  margemContribuicao: number | null;
  margemPercentual: number | null;
}

export interface ResumoPedidosShopee {
  totalPedidos: number;
  pedidosAprovados: number;
  pedidosCancelados: number;
  // A Shopee não devolve o valor do pedido em get_order_list (só em
  // get_order_detail) — buscar o detalhe de pedidos cancelados só pra essa
  // métrica não vale o custo de mais uma chamada por enquanto. Fica 0.
  valorCancelado: number;
}

export interface ResultadoFinanceiroShopee {
  vendas: VendaFinanceiraShopee[];
  resumoPedidos: ResumoPedidosShopee;
}

interface LojaShopee {
  id: number;
  nome: string;
  imposto_percentual: number;
}

async function listarLojasComShopee(): Promise<LojaShopee[]> {
  const { rows } = await pool.query<LojaShopee>(
    `SELECT l.id, l.nome, l.imposto_percentual
     FROM lojas l
     JOIN contas_shopee c ON c.loja_id = l.id
     ORDER BY l.id`
  );
  return rows;
}

// Mesmo cache de 15 min do Financeiro do Mercado Livre — feed de atividade
// recente, não precisa reprocessar tudo a cada requisição.
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { data: ResultadoFinanceiroShopee; expiraEm: number }>();

export async function listarVendasFinanceirasShopee(
  lojaIdFiltro?: number,
  lojasPermitidas?: number[],
  dataInicio?: string,
  dataFim?: string,
  forcarAtualizacao = false
): Promise<ResultadoFinanceiroShopee> {
  const lojas = (await listarLojasComShopee()).filter(
    (l) =>
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
  const timeFrom = Math.floor(new Date(janela.inicioDia).getTime() / 1000);
  const timeTo = Math.floor(new Date(janela.agora).getTime() / 1000);

  const [produtos, pedidosPorLoja] = await Promise.all([
    listarProdutos(),
    Promise.all(
      lojas.map(async (loja) => ({
        lojaId: loja.id,
        lojaNome: loja.nome,
        impostoPercentual: loja.imposto_percentual,
        pedidos: await listarPedidos(loja.id, timeFrom, timeTo),
      }))
    ),
  ]);

  const custoPorSku = new Map(produtos.map((p) => [normalizarSku(p.sku), p.custo]));

  const todosOsPedidos = pedidosPorLoja.flatMap((l) => l.pedidos);
  const resumoPedidos: ResumoPedidosShopee = {
    totalPedidos: todosOsPedidos.length,
    pedidosAprovados: todosOsPedidos.filter((p) => pedidoValido(p.order_status)).length,
    pedidosCancelados: todosOsPedidos.filter((p) => STATUS_CANCELADOS.has(p.order_status)).length,
    valorCancelado: 0,
  };

  // Detalhe (itens, sku, valores) só dos pedidos válidos — igual ao ML, não
  // busca detalhe de pedido cancelado/não pago.
  const detalhesPorLoja = await Promise.all(
    pedidosPorLoja.map(async (loja) => {
      const validos = loja.pedidos.filter((p) => pedidoValido(p.order_status)).map((p) => p.order_sn);
      return {
        lojaId: loja.lojaId,
        lojaNome: loja.lojaNome,
        impostoPercentual: loja.impostoPercentual,
        detalhes: validos.length > 0 ? await buscarDetalhesPedidos(loja.lojaId, validos) : [],
      };
    })
  );

  const vendas: VendaFinanceiraShopee[] = [];
  for (const loja of detalhesPorLoja) {
    for (const pedido of loja.detalhes) {
      for (const item of pedido.item_list ?? []) {
        // Item com variação (cor/tamanho) tem o SKU e a quantidade em cada
        // entrada de model_list, não no item em si — sem variação, o
        // próprio item_sku/quantidade já bastam. Trata os dois casos como
        // uma lista de "modelos" pra não duplicar o loop de cálculo.
        const semVariacao: ShopeeOrderItemModel = {};
        const modelos = item.model_list && item.model_list.length > 0 ? item.model_list : [semVariacao];

        for (const modelo of modelos) {
          const sku = modelo.model_sku || item.item_sku || null;
          const quantidade = modelo.model_quantity_purchased ?? 1;
          const valorUnitario = modelo.model_discounted_price ?? 0;
          const custoUnitario = sku !== null ? custoPorSku.get(normalizarSku(sku)) ?? null : null;
          const receitaTotal = valorUnitario * quantidade;
          const custoTotal = custoUnitario !== null ? custoUnitario * quantidade : null;
          const impostoTotal = arredondarCentavos(receitaTotal * (loja.impostoPercentual / 100));
          // Sem desconto de taxa/comissão da Shopee ainda — campo real não
          // confirmado (ver nota em financeiroShopeeService.ts e no plano).
          const margemContribuicao = custoTotal !== null ? receitaTotal - custoTotal - impostoTotal : null;

          vendas.push({
            orderSn: pedido.order_sn,
            itemId: item.item_id,
            dataCriacao: new Date(pedido.create_time * 1000).toISOString(),
            lojaId: loja.lojaId,
            lojaNome: loja.lojaNome,
            titulo: item.item_name,
            sku,
            valorUnitario,
            quantidade,
            receitaTotal,
            custoTotal,
            impostoTotal,
            margemContribuicao,
            margemPercentual:
              margemContribuicao !== null && receitaTotal > 0 ? (margemContribuicao / receitaTotal) * 100 : null,
          });
        }
      }
    }
  }

  vendas.sort((a, b) => new Date(b.dataCriacao).getTime() - new Date(a.dataCriacao).getTime());

  const resultado: ResultadoFinanceiroShopee = { vendas, resumoPedidos };
  cache.set(chaveCache, { data: resultado, expiraEm: Date.now() + CACHE_TTL_MS });
  return resultado;
}
