import { pool } from "../db/pool";
import { listarPedidos, buscarDetalhesPedidos, buscarTaxasPedidos } from "./shopeeApi";
import { listarProdutos } from "./produtosService";
import { janelaUltimosDias, janelaEntre } from "./dateUtils";
import { obterGastoAdsShopee } from "./shopeeAdsService";
import { chamarApiAssinada } from "./shopeeAuth";

const DIAS_JANELA = 7;

// Enum de status confirmado ao vivo contra pedidos reais da Perpétua
// (READY_TO_SHIP, UNPAID, CANCELLED, SHIPPED, TO_CONFIRM_RECEIVE, COMPLETED,
// TO_RETURN) — bateu exatamente com o total/cancelados que a Shopee mostra.
const STATUS_CANCELADOS = new Set(["CANCELLED", "IN_CANCEL"]);
const STATUS_NAO_PAGOS = new Set(["UNPAID", "INVOICE_PENDING"]);
// Devolução em andamento (comprador pediu, ainda não resolvida) — mesmo
// tratamento conservador de CANCELLED/UNPAID: não conta como venda enquanto
// o dinheiro pode voltar pro comprador. Como o status é buscado ao vivo (não
// trava no que era na hora da venda), se a devolução for negada o pedido
// volta a contar sozinho na próxima atualização, sem precisar de ajuste.
const STATUS_EM_DEVOLUCAO = new Set(["TO_RETURN"]);

function pedidoValido(status: string): boolean {
  return !STATUS_CANCELADOS.has(status) && !STATUS_NAO_PAGOS.has(status) && !STATUS_EM_DEVOLUCAO.has(status);
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
  taxaShopeeTotal: number;
  comissaoAfiliadoTotal: number;
  cupomVendedorTotal: number;
  freteVendedorTotal: number;
  margemContribuicao: number | null;
  margemPercentual: number | null;
  // true quando a propria Shopee zerou o preco desse item (promocao tipo
  // "leve X por Y"/kit — o item de verdade saiu, custo de verdade existe,
  // mas o faturamento dele é R$0 por desenho da promoção, não erro de
  // cadastro). Ver model_original_price > 0 com preco de venda zerado.
  itemBrinde: boolean;
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
  gastoAdsTotal: number;
  // Pedidos cujo extrato (taxas, afiliado, cupom, frete) a Shopee não devolveu
  // nem com tentativas repetidas: entram com taxa zero, então a margem deles
  // fica inflada. A tela avisa em vez de mostrar sem dizer nada.
  pedidosSemTaxa: number;
}

interface LojaShopee {
  id: number;
  nome: string;
  imposto_percentual: number;
}

// Exportada também pro Ponto de Equilíbrio (financeiroService.ts), que
// precisa saber quais lojas têm Shopee pra incluir no custo fixo mesmo uma
// loja que não tenha Mercado Livre conectado.
export async function listarLojasComShopee(): Promise<LojaShopee[]> {
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

  const [produtos, pedidosPorLoja, gastoAdsTotal] = await Promise.all([
    listarProdutos(forcarAtualizacao),
    Promise.all(
      lojas.map(async (loja) => ({
        lojaId: loja.id,
        lojaNome: loja.nome,
        impostoPercentual: loja.imposto_percentual,
        pedidos: await listarPedidos(loja.id, timeFrom, timeTo),
      }))
    ),
    // Igual ao gastoAdsTotal do Financeiro do Mercado Livre: não é por
    // venda, só entra no total da janela. Ver shopeeAdsService.ts.
    obterGastoAdsShopee(lojaIdFiltro, lojasPermitidas, janela.inicioDia.slice(0, 10), janela.agora.slice(0, 10)),
  ]);

  const custoPorSku = new Map(produtos.map((p) => [normalizarSku(p.sku), p.custo]));

  const todosOsPedidos = pedidosPorLoja.flatMap((l) => l.pedidos);
  const resumoPedidos: ResumoPedidosShopee = {
    totalPedidos: todosOsPedidos.length,
    pedidosAprovados: todosOsPedidos.filter((p) => pedidoValido(p.order_status)).length,
    pedidosCancelados: todosOsPedidos.filter((p) => STATUS_CANCELADOS.has(p.order_status)).length,
    valorCancelado: 0,
  };

  // Detalhe (itens, sku, valores) e taxa (comissão + serviço) só dos
  // pedidos válidos — igual ao ML, não busca detalhe de pedido
  // cancelado/não pago.
  const detalhesPorLoja = await Promise.all(
    pedidosPorLoja.map(async (loja) => {
      const validos = loja.pedidos.filter((p) => pedidoValido(p.order_status)).map((p) => p.order_sn);
      const [detalhes, taxas] =
        validos.length > 0
          ? await Promise.all([buscarDetalhesPedidos(loja.lojaId, validos), buscarTaxasPedidos(loja.lojaId, validos)])
          : [[], new Map()];
      return {
        lojaId: loja.lojaId,
        lojaNome: loja.lojaNome,
        impostoPercentual: loja.impostoPercentual,
        detalhes,
        taxas,
      };
    })
  );

  const vendas: VendaFinanceiraShopee[] = [];
  let pedidosSemTaxa = 0;
  for (const loja of detalhesPorLoja) {
    for (const pedido of loja.detalhes) {
      if (!loja.taxas.has(pedido.order_sn)) pedidosSemTaxa++;
      // Cada entrada de item_list já é uma linha vendida (um line_item_id) —
      // monta a lista primeiro porque a taxa (comissão + serviço) só vem no
      // nível do PEDIDO inteiro, precisa do total do pedido pra ratear por
      // linha depois.
      const linhas = (pedido.item_list ?? []).map((item) => {
        const sku = item.model_sku || item.item_sku || null;
        const quantidade = item.model_quantity_purchased ?? 1;
        const valorUnitario = item.model_discounted_price ?? 0;
        // Base do rateio: preço ORIGINAL (de tabela), não o preço com
        // desconto. Achado ao vivo: em promoção tipo "leve X por Y"/kit, a
        // Shopee zera o preço de um dos itens (valorUnitario = 0) — se o
        // rateio usasse receita real, esse item ficaria com 0% da taxa do
        // pedido e o OUTRO item do mesmo pedido levaria 100% sozinho,
        // inflando a taxa dele bem acima do normal pra aquele SKU. Usando o
        // preço de tabela, o item "de graça" carrega sua fatia justa mesmo
        // sem ter faturado nada.
        const valorOriginalUnitario = item.model_original_price ?? valorUnitario;
        const itemBrinde = valorUnitario === 0 && valorOriginalUnitario > 0;
        return {
          item,
          sku,
          quantidade,
          valorUnitario,
          receitaTotal: valorUnitario * quantidade,
          valorOriginalTotal: valorOriginalUnitario * quantidade,
          itemBrinde,
        };
      });

      const receitaTotalPedido = linhas.reduce((soma, l) => soma + l.receitaTotal, 0);
      const valorOriginalTotalPedido = linhas.reduce((soma, l) => soma + l.valorOriginalTotal, 0);
      const taxaPedido = loja.taxas.get(pedido.order_sn);
      const taxaTotalPedido = (taxaPedido?.comissao ?? 0) + (taxaPedido?.taxaServico ?? 0);
      const comissaoAfiliadoPedido = taxaPedido?.comissaoAfiliado ?? 0;
      const cupomVendedorPedido = taxaPedido?.cupomVendedor ?? 0;
      const freteVendedorPedido = taxaPedido?.freteVendedor ?? 0;

      for (const linha of linhas) {
        const custoUnitario = linha.sku !== null ? custoPorSku.get(normalizarSku(linha.sku)) ?? null : null;
        const custoTotal = custoUnitario !== null ? custoUnitario * linha.quantidade : null;
        const impostoTotal = arredondarCentavos(linha.receitaTotal * (loja.impostoPercentual / 100));
        const fatia = valorOriginalTotalPedido > 0 ? linha.valorOriginalTotal / valorOriginalTotalPedido : 0;
        // Comissão + taxa de serviço vêm só no total do pedido (get_escrow_
        // detail), não por item — rateia pela fatia de preço de tabela de
        // cada linha dentro do pedido (ver comentário acima).
        const taxaShopeeTotal = arredondarCentavos(fatia * taxaTotalPedido);
        // Comissão do programa de afiliados da Shopee (AMS) — mesmo rateio,
        // exibida separada da Taxa Shopee pra ficar explícito quando uma
        // venda veio de link de afiliado/creator. Normalmente 0.
        const comissaoAfiliadoTotal = arredondarCentavos(fatia * comissaoAfiliadoPedido);
        // Cupom custeado pelo vendedor — igual à taxa, só vem no total do
        // pedido, rateado pela mesma fatia. É custo real (sai do bolso do
        // vendedor), então entra na margem igual imposto/taxa.
        const cupomVendedorTotal = arredondarCentavos(fatia * cupomVendedorPedido);
        // Frete real do vendedor (ver buscarTaxasPedidos em shopeeApi.ts) —
        // mesmo rateio de taxa/cupom. Na prática costuma sair 0 (a Shopee
        // reembolsa o frete integralmente via programa de frete grátis),
        // mas fica pronto pro caso de não reembolsar.
        const freteVendedorTotal = arredondarCentavos(fatia * freteVendedorPedido);
        const margemContribuicao =
          custoTotal !== null
            ? linha.receitaTotal -
              custoTotal -
              impostoTotal -
              taxaShopeeTotal -
              comissaoAfiliadoTotal -
              cupomVendedorTotal -
              freteVendedorTotal
            : null;

        vendas.push({
          orderSn: pedido.order_sn,
          itemId: linha.item.item_id,
          dataCriacao: new Date(pedido.create_time * 1000).toISOString(),
          lojaId: loja.lojaId,
          lojaNome: loja.lojaNome,
          titulo: linha.item.item_name,
          sku: linha.sku,
          valorUnitario: linha.valorUnitario,
          quantidade: linha.quantidade,
          receitaTotal: linha.receitaTotal,
          custoTotal,
          impostoTotal,
          taxaShopeeTotal,
          comissaoAfiliadoTotal,
          cupomVendedorTotal,
          freteVendedorTotal,
          margemContribuicao,
          margemPercentual:
            margemContribuicao !== null && linha.receitaTotal > 0
              ? (margemContribuicao / linha.receitaTotal) * 100
              : null,
          itemBrinde: linha.itemBrinde,
        });
      }
    }
  }

  vendas.sort((a, b) => new Date(b.dataCriacao).getTime() - new Date(a.dataCriacao).getTime());

  const resultado: ResultadoFinanceiroShopee = { vendas, resumoPedidos, gastoAdsTotal, pedidosSemTaxa };
  cache.set(chaveCache, { data: resultado, expiraEm: Date.now() + CACHE_TTL_MS });
  return resultado;
}

export interface DiagnosticoAfiliadoPedido {
  orderSn: string;
  status: string;
  itens: { itemId: number; sku: string | null; amsDoItem: number | null }[];
  // Todos os campos NUMÉRICOS do order_income devolvido pela Shopee, como
  // vieram — pra achar onde a comissão de afiliado aparece de verdade.
  campos: Record<string, number>;
  // preço de venda − cupom do vendedor − comissão − taxa de serviço − afiliado
  // (a conta que o Financeiro Shopee faz) e quanto ela erra contra o
  // escrow_amount, o que a Shopee de fato repassa. Perto de 0 = a conta fecha.
  contaDoSistema: number | null;
  escrowAmount: number | null;
  diferenca: number | null;
}

// Diagnóstico (só admin): olha o extrato real (get_escrow_detail) de pedidos
// recentes de uma loja, opcionalmente só os que têm `termo` no nome/SKU do
// item, e confere se a conta de taxas do Financeiro fecha com o valor que a
// Shopee repassa. Serve pra confirmar se a comissão de afiliado (AMS) vem
// preenchida e se está sendo descontada na medida certa.
export async function diagnosticarAfiliadoShopee(
  lojaId: number,
  dias: number,
  termo: string | null,
  limite: number,
  status: string | null = null,
  orderSns: string[] | null = null
): Promise<{ parcial: boolean; erros: string[]; pedidosAnalisados: number; comAfiliado: number; pedidos: DiagnosticoAfiliadoPedido[] }> {
  let escolhidos: Awaited<ReturnType<typeof buscarDetalhesPedidos>>;
  if (orderSns && orderSns.length > 0) {
    // Pedidos pedidos pelo número: não precisa listar a janela inteira.
    escolhidos = await buscarDetalhesPedidos(lojaId, orderSns.slice(0, 20));
  } else {
    const janela = janelaUltimosDias(dias);
    const timeFrom = Math.floor(new Date(janela.inicioDia).getTime() / 1000);
    const timeTo = Math.floor(new Date(janela.agora).getTime() / 1000);
    const lista = (await listarPedidos(lojaId, timeFrom, timeTo)).filter(
      (p) => pedidoValido(p.order_status) && (status === null || p.order_status === status)
    );
    const detalhes = await buscarDetalhesPedidos(
      lojaId,
      lista.slice(0, 150).map((p) => p.order_sn)
    );
    const termoNorm = termo ? termo.toLowerCase() : null;
    escolhidos = detalhes
      .filter(
        (d) =>
          termoNorm === null ||
          d.item_list.some((i) =>
            `${i.item_name} ${i.model_sku ?? ""} ${i.item_sku ?? ""}`.toLowerCase().includes(termoNorm)
          )
      )
      .slice(0, limite);
  }

  // O prazo só conta a partir daqui (listar e buscar detalhes pode demorar
  // bastante numa loja grande); devolve o que analisou até lá, em vez de ficar carregando.
  const prazo = Date.now() + 45_000;
  const pedidos: DiagnosticoAfiliadoPedido[] = [];
  let parcial = false;
  const erros: string[] = [];
  async function analisar(d: (typeof escolhidos)[number]) {
    if (Date.now() > prazo) {
      parcial = true;
      return;
    }
    const data = await chamarApiAssinada<{
      error?: string;
      response?: { order_income?: Record<string, unknown> & { items?: Record<string, unknown>[] } };
    }>(lojaId, "/api/v2/payment/get_escrow_detail", { order_sn: d.order_sn });
    const income = data.response?.order_income;
    const campos: Record<string, number> = {};
    for (const [k, v] of Object.entries(income ?? {})) {
      if (typeof v === "number") campos[k] = v;
    }
    const itensEscrow = (income?.items ?? []) as { item_id?: number; model_sku?: string; item_sku?: string; ams_commission_fee?: number }[];
    const preco = campos.order_selling_price;
    const escrow = campos.escrow_amount;
    const conta =
      preco === undefined
        ? null
        : preco -
          (campos.voucher_from_seller ?? 0) -
          (campos.commission_fee ?? 0) -
          (campos.service_fee ?? 0) -
          (campos.order_ams_commission_fee ?? 0);
    pedidos.push({
      orderSn: d.order_sn,
      status: d.order_status,
      itens: itensEscrow.map((i) => ({
        itemId: i.item_id ?? 0,
        sku: i.model_sku || i.item_sku || null,
        amsDoItem: typeof i.ams_commission_fee === "number" ? i.ams_commission_fee : null,
      })),
      campos,
      contaDoSistema: conta === null ? null : Math.round(conta * 100) / 100,
      escrowAmount: escrow ?? null,
      diferenca: conta === null || escrow === undefined ? null : Math.round((conta - escrow) * 100) / 100,
    });
  }
  let proximo = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, escolhidos.length) }, async () => {
      while (proximo < escolhidos.length) {
        const d = escolhidos[proximo++];
        try {
          await analisar(d);
        } catch (err) {
          erros.push(`${d.order_sn}: ${err instanceof Error ? err.message : "falhou"}`);
        }
      }
    })
  );
  return {
    parcial,
    erros,
    pedidosAnalisados: pedidos.length,
    comAfiliado: pedidos.filter((p) => (p.campos.order_ams_commission_fee ?? 0) > 0).length,
    pedidos,
  };
}
