import { listLojas } from "./tokenStore";
import {
  searchOrders,
  getItemsBasicInfo,
  getPromocaoStatus,
  getAdsStatus,
  MlOrder,
  PromocaoStatus,
  AdsStatus,
} from "./mercadoLivreApi";
import { janelaHoje, janelaOntemMesmoHorario, janelaUltimosDias, horaLocal, chaveJanelaDoDia } from "./dateUtils";

const STATUS_VALIDOS = new Set(["paid", "confirmed"]);

function valorOrder(order: MlOrder): number {
  return STATUS_VALIDOS.has(order.status) ? Number(order.total_amount) : 0;
}

interface OrdersPorLoja {
  lojaId: number;
  lojaNome: string;
  hoje: MlOrder[];
  ontem: MlOrder[];
}

async function buscarOrdersDeTodasLojas(lojaIdFiltro?: number, lojasPermitidas?: number[]): Promise<OrdersPorLoja[]> {
  const lojas = (await listLojas()).filter(
    (l) =>
      l.ml_user_id !== null &&
      (lojaIdFiltro === undefined || l.id === lojaIdFiltro) &&
      (lojasPermitidas === undefined || lojasPermitidas.includes(l.id))
  );
  const hoje = janelaHoje();
  const ontem = janelaOntemMesmoHorario();

  return Promise.all(
    lojas.map(async (loja) => {
      const [ordersHoje, ordersOntem] = await Promise.all([
        searchOrders(loja.id, loja.ml_user_id as number, hoje.inicioDia, hoje.agora),
        searchOrders(loja.id, loja.ml_user_id as number, ontem.inicioDia, ontem.agora),
      ]);
      return { lojaId: loja.id, lojaNome: loja.nome, hoje: ordersHoje, ontem: ordersOntem };
    })
  );
}

export interface DashboardData {
  faturamentoHoje: number;
  faturamentoOntemMesmoHorario: number;
  variacaoPercentual: number | null;
  rankingLojas: Array<{
    lojaId: number;
    lojaNome: string;
    valor: number;
    numVendas: number;
    numUnidades: number;
    percentualDoTotal: number;
  }>;
  vendasPorHora: Array<{ hora: number; hoje: number; ontem: number }>;
  produtosMaisVendidos: Array<{
    sku: string | null;
    mlItemId: string;
    titulo: string;
    lojaId: number;
    lojaNome: string;
    precoTotal: number;
    quantidade: number;
    foto: string | null;
    linkMl: string | null;
  }>;
  ultimaVendaEm: string | null;
}

// Painel ao vivo: com várias pessoas logadas ao mesmo tempo, cada uma
// pollando a cada 2 min, sem cache isso vira N buscas simultâneas nas
// mesmas lojas na API do Mercado Livre. TTL curto (bem menor que o
// intervalo de poll do frontend) pra absorver essas requisições
// concorrentes sem deixar o número visivelmente desatualizado.
const TTL_DASHBOARD_MS = 60 * 1000;
const cacheDashboard = new Map<string, { data: DashboardData; expiraEm: number }>();

function chaveCacheDashboard(lojaIdFiltro?: number, lojasPermitidas?: number[]): string {
  const permitidas = lojasPermitidas ? [...lojasPermitidas].sort((a, b) => a - b).join(",") : "todas";
  return `${lojaIdFiltro ?? "todas"}|${permitidas}`;
}

export async function getDashboardData(lojaIdFiltro?: number, lojasPermitidas?: number[]): Promise<DashboardData> {
  const chaveCache = chaveCacheDashboard(lojaIdFiltro, lojasPermitidas);
  const emCache = cacheDashboard.get(chaveCache);
  if (emCache && emCache.expiraEm > Date.now()) {
    return emCache.data;
  }

  const porLoja = await buscarOrdersDeTodasLojas(lojaIdFiltro, lojasPermitidas);

  const faturamentoHoje = porLoja.reduce(
    (soma, l) => soma + l.hoje.reduce((s, o) => s + valorOrder(o), 0),
    0
  );
  const faturamentoOntemMesmoHorario = porLoja.reduce(
    (soma, l) => soma + l.ontem.reduce((s, o) => s + valorOrder(o), 0),
    0
  );
  const variacaoPercentual =
    faturamentoOntemMesmoHorario > 0
      ? ((faturamentoHoje - faturamentoOntemMesmoHorario) / faturamentoOntemMesmoHorario) * 100
      : null;

  const rankingLojas = porLoja
    .map((l) => {
      const validos = l.hoje.filter((o) => STATUS_VALIDOS.has(o.status));
      const valor = validos.reduce((s, o) => s + Number(o.total_amount), 0);
      const numUnidades = validos.reduce(
        (s, o) => s + o.order_items.reduce((si, it) => si + it.quantity, 0),
        0
      );
      return {
        lojaId: l.lojaId,
        lojaNome: l.lojaNome,
        valor,
        numVendas: validos.length,
        numUnidades,
        percentualDoTotal: 0,
      };
    })
    .map((r) => ({
      ...r,
      percentualDoTotal: faturamentoHoje > 0 ? (r.valor / faturamentoHoje) * 100 : 0,
    }))
    .sort((a, b) => b.valor - a.valor);

  const horas = Array.from({ length: 24 }, (_, hora) => ({ hora, hoje: 0, ontem: 0 }));
  for (const l of porLoja) {
    for (const o of l.hoje.filter((x) => STATUS_VALIDOS.has(x.status))) {
      horas[horaLocal(o.date_created)].hoje += Number(o.total_amount);
    }
    for (const o of l.ontem.filter((x) => STATUS_VALIDOS.has(x.status))) {
      horas[horaLocal(o.date_created)].ontem += Number(o.total_amount);
    }
  }

  const produtosMap = new Map<
    string,
    {
      lojaId: number;
      mlItemId: string;
      sku: string | null;
      titulo: string;
      lojaNome: string;
      precoTotal: number;
      quantidade: number;
    }
  >();
  for (const l of porLoja) {
    for (const o of l.hoje.filter((x) => STATUS_VALIDOS.has(x.status))) {
      for (const item of o.order_items) {
        const chave = `${l.lojaId}:${item.item.id}`;
        const atual = produtosMap.get(chave) ?? {
          lojaId: l.lojaId,
          mlItemId: item.item.id,
          sku: item.item.seller_sku ?? null,
          titulo: item.item.title,
          lojaNome: l.lojaNome,
          precoTotal: 0,
          quantidade: 0,
        };
        atual.precoTotal += item.unit_price * item.quantity;
        atual.quantidade += item.quantity;
        produtosMap.set(chave, atual);
      }
    }
  }

  const produtosTop = Array.from(produtosMap.values())
    .sort((a, b) => b.quantidade - a.quantidade)
    .slice(0, 20);

  const idsPorLoja = new Map<number, string[]>();
  for (const p of produtosTop) {
    const lista = idsPorLoja.get(p.lojaId) ?? [];
    lista.push(p.mlItemId);
    idsPorLoja.set(p.lojaId, lista);
  }
  const itensPorLoja = new Map<number, Awaited<ReturnType<typeof getItemsBasicInfo>>>();
  await Promise.all(
    Array.from(idsPorLoja.entries()).map(async ([lojaId, ids]) => {
      itensPorLoja.set(lojaId, await getItemsBasicInfo(lojaId, ids));
    })
  );

  const produtosMaisVendidos = produtosTop.map((p) => {
    const item = itensPorLoja.get(p.lojaId)?.get(p.mlItemId);
    return {
      sku: p.sku,
      mlItemId: p.mlItemId,
      titulo: p.titulo,
      lojaId: p.lojaId,
      lojaNome: p.lojaNome,
      precoTotal: p.precoTotal,
      quantidade: p.quantidade,
      foto: item?.thumbnail ?? null,
      linkMl: item?.permalink ?? null,
    };
  });

  let ultimaVendaEm: string | null = null;
  for (const l of porLoja) {
    for (const o of l.hoje.filter((x) => STATUS_VALIDOS.has(x.status))) {
      if (!ultimaVendaEm || new Date(o.date_created) > new Date(ultimaVendaEm)) {
        ultimaVendaEm = o.date_created;
      }
    }
  }

  const resultado: DashboardData = {
    faturamentoHoje,
    faturamentoOntemMesmoHorario,
    variacaoPercentual,
    rankingLojas,
    vendasPorHora: horas,
    produtosMaisVendidos,
    ultimaVendaEm,
  };
  cacheDashboard.set(chaveCache, { data: resultado, expiraEm: Date.now() + TTL_DASHBOARD_MS });
  return resultado;
}

export interface VendaRecente {
  chave: string;
  lojaId: number;
  lojaNome: string;
  titulo: string;
  quantidade: number;
  valor: number;
  dataCriacao: string;
}

// Feed "ao vivo" de vendas pro Modo TV — bem mais leve que
// listarVendasFinanceiras (financeiroService.ts): sem custo/frete/imposto,
// só o pedido bruto do dia já buscado por buscarOrdersDeTodasLojas, quebrado
// por item de venda. Não serve pra número financeiro (não é lucro real),
// só pra "você vendeu tal produto agora".
const TTL_VENDAS_RECENTES_MS = 60 * 1000;
const cacheVendasRecentes = new Map<string, { data: VendaRecente[]; expiraEm: number }>();

export async function listarVendasRecentes(lojaIds: number[]): Promise<VendaRecente[]> {
  const chaveCache = [...lojaIds].sort((a, b) => a - b).join(",");
  const emCache = cacheVendasRecentes.get(chaveCache);
  if (emCache && emCache.expiraEm > Date.now()) {
    return emCache.data;
  }

  const porLoja = await buscarOrdersDeTodasLojas(undefined, lojaIds);

  const vendas: VendaRecente[] = [];
  for (const loja of porLoja) {
    for (const order of loja.hoje) {
      if (!STATUS_VALIDOS.has(order.status)) continue;
      for (const item of order.order_items) {
        vendas.push({
          chave: `${order.id}-${item.item.id}`,
          lojaId: loja.lojaId,
          lojaNome: loja.lojaNome,
          titulo: item.item.title,
          quantidade: item.quantity,
          valor: item.unit_price * item.quantity,
          dataCriacao: order.date_created,
        });
      }
    }
  }
  vendas.sort((a, b) => new Date(b.dataCriacao).getTime() - new Date(a.dataCriacao).getTime());

  const top = vendas.slice(0, 30);
  cacheVendasRecentes.set(chaveCache, { data: top, expiraEm: Date.now() + TTL_VENDAS_RECENTES_MS });
  return top;
}

export interface TopVendidoPromocao {
  mlItemId: string;
  titulo: string;
  lojaId: number;
  lojaNome: string;
  precoTotal: number;
  quantidade: number;
  foto: string | null;
  linkMl: string | null;
  promocao: PromocaoStatus;
  ads: AdsStatus;
}

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

// Buscar 60 dias de pedidos em várias lojas + checar promoção item a item é
// lento (pode passar de 20s com várias lojas). Como esse painel é um
// diagnóstico (não uma métrica ao vivo) e o pedido foi de no máximo 2
// atualizações por dia, o cache não usa TTL corrido — a chave inclui a
// "janela do dia" (ver chaveJanelaDoDia), que só muda nos horários-âncora.
// Assim só a primeira requisição depois de cada âncora refaz a busca; o
// resto do dia (e trocas de filtro repetidas) usam o resultado guardado.
const HORARIOS_ATUALIZACAO_PROMOCOES = [8, 15];
const cacheTopVendidos = new Map<string, TopVendidoPromocao[]>();

export async function getTopVendidosPromocoes(
  lojaIdFiltro?: number,
  lojasPermitidas?: number[]
): Promise<TopVendidoPromocao[]> {
  const lojas = (await listLojas()).filter(
    (l) =>
      l.ml_user_id !== null &&
      (lojaIdFiltro === undefined || l.id === lojaIdFiltro) &&
      (lojasPermitidas === undefined || lojasPermitidas.includes(l.id))
  );

  const escopoLojas = lojas
    .map((l) => l.id)
    .sort((a, b) => a - b)
    .join(",");
  const chaveCache = `${escopoLojas}|${chaveJanelaDoDia(HORARIOS_ATUALIZACAO_PROMOCOES)}`;
  const emCache = cacheTopVendidos.get(chaveCache);
  if (emCache) {
    return emCache;
  }

  const janela = janelaUltimosDias(60);

  const ordersPorLoja = await Promise.all(
    lojas.map(async (loja) => ({
      lojaId: loja.id,
      lojaNome: loja.nome,
      orders: await searchOrders(loja.id, loja.ml_user_id as number, janela.inicioDia, janela.agora),
    }))
  );

  const produtosMap = new Map<
    string,
    { lojaId: number; mlItemId: string; titulo: string; lojaNome: string; precoTotal: number; quantidade: number }
  >();
  for (const l of ordersPorLoja) {
    for (const o of l.orders.filter((x) => STATUS_VALIDOS.has(x.status))) {
      for (const item of o.order_items) {
        const chave = `${l.lojaId}:${item.item.id}`;
        const atual = produtosMap.get(chave) ?? {
          lojaId: l.lojaId,
          mlItemId: item.item.id,
          titulo: item.item.title,
          lojaNome: l.lojaNome,
          precoTotal: 0,
          quantidade: 0,
        };
        atual.precoTotal += item.unit_price * item.quantity;
        atual.quantidade += item.quantity;
        produtosMap.set(chave, atual);
      }
    }
  }

  const top20 = Array.from(produtosMap.values())
    .sort((a, b) => b.quantidade - a.quantidade)
    .slice(0, 20);

  const idsPorLoja = new Map<number, string[]>();
  for (const p of top20) {
    const lista = idsPorLoja.get(p.lojaId) ?? [];
    lista.push(p.mlItemId);
    idsPorLoja.set(p.lojaId, lista);
  }
  const itensPorLoja = new Map<number, Awaited<ReturnType<typeof getItemsBasicInfo>>>();
  await Promise.all(
    Array.from(idsPorLoja.entries()).map(async ([lojaId, ids]) => {
      itensPorLoja.set(lojaId, await getItemsBasicInfo(lojaId, ids));
    })
  );

  const [promocoes, adsStatus] = await Promise.all([
    comConcorrenciaLimitada(top20, 5, async (p) => getPromocaoStatus(p.lojaId, p.mlItemId)),
    comConcorrenciaLimitada(top20, 5, async (p) => getAdsStatus(p.lojaId, p.mlItemId)),
  ]);

  const resultado = top20.map((p, i) => {
    const item = itensPorLoja.get(p.lojaId)?.get(p.mlItemId);
    return {
      mlItemId: p.mlItemId,
      titulo: p.titulo,
      lojaId: p.lojaId,
      lojaNome: p.lojaNome,
      precoTotal: p.precoTotal,
      quantidade: p.quantidade,
      foto: item?.thumbnail ?? null,
      linkMl: item?.permalink ?? null,
      promocao: promocoes[i],
      ads: adsStatus[i],
    };
  });

  cacheTopVendidos.set(chaveCache, resultado);
  return resultado;
}
