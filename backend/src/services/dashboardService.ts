import { listLojas } from "./tokenStore";
import { searchOrders, getItemsBasicInfo, MlOrder } from "./mercadoLivreApi";
import { janelaHoje, janelaOntemMesmoHorario, horaLocal } from "./dateUtils";

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

export async function getDashboardData(lojaIdFiltro?: number, lojasPermitidas?: number[]): Promise<DashboardData> {
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

  return {
    faturamentoHoje,
    faturamentoOntemMesmoHorario,
    variacaoPercentual,
    rankingLojas,
    vendasPorHora: horas,
    produtosMaisVendidos,
    ultimaVendaEm,
  };
}
