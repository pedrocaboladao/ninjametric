import { listarVendasFinanceiras } from "./financeiroService";
import { calcularCustoFixoDetalhado } from "./contasService";

export interface DreMes {
  mes: number; // 1-12
  faturamento: number;
  freteVendedor: number;
  custoProdutos: number;
  taxaMl: number;
  imposto: number;
  cancelamentos: number;
  margemContribuicao: number;
  margemPercentual: number | null;
  gastoAds: number;
  custoFixoManual: number;
  custoFixoTotal: number;
  lucroLiquido: number;
  lucroPercentual: number | null;
}

export interface CustoFixoLinhaDre {
  descricao: string;
  porMes: number[]; // 12 posições, índice 0 = janeiro
  total: number;
}

export interface Dre {
  ano: number;
  meses: DreMes[];
  totais: DreMes;
  custoFixoDetalhado: CustoFixoLinhaDre[];
}

function mesVazio(mes: number): DreMes {
  return {
    mes,
    faturamento: 0,
    freteVendedor: 0,
    custoProdutos: 0,
    taxaMl: 0,
    imposto: 0,
    cancelamentos: 0,
    margemContribuicao: 0,
    margemPercentual: null,
    gastoAds: 0,
    custoFixoManual: 0,
    custoFixoTotal: 0,
    lucroLiquido: 0,
    lucroPercentual: null,
  };
}

function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(ano, mes, 0).getDate();
}

function dataISO(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
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

// Reaproveita 100% o cálculo já existente do Financeiro (frete, custo,
// taxa, imposto, margem, cancelamentos, gasto de Ads) — o DRE só agrupa
// isso por mês, não reimplementa nada. Não busca mês futuro (sem dado
// possível). Concorrência limitada entre os meses porque cada mês já
// dispara buscas em paralelo por loja internamente — buscar os 12 meses
// inteiros ao mesmo tempo, com várias lojas, sobrecarregaria a API do
// Mercado Livre à toa; cada mês já tem seu próprio cache de 15min (ver
// listarVendasFinanceiras), então recarregar a mesma tela é rápido depois
// da primeira vez.
const CONCORRENCIA_MESES = 3;

// O DRE só passa a existir a partir deste mês — testamos buscar o
// histórico retroativo (Jan-Ago de uma vez) e a API do Mercado Livre
// devolveu 429 (Too Many Requests). Em vez de tentar "backfill" de meses
// que já passaram antes da feature existir, os meses vão se acumulando
// naturalmente com o tempo: mês que vem já mostra ago+set, e assim por
// diante — sem nunca disparar uma rajada grande de buscas retroativas de
// uma vez só.
const DRE_INICIO_ANO = 2026;
const DRE_INICIO_MES = 8;

function mesesParaCalcular(ano: number, anoAtual: number, mesAtual: number): number[] {
  if (ano < DRE_INICIO_ANO || ano > anoAtual) return [];
  const primeiroMes = ano === DRE_INICIO_ANO ? DRE_INICIO_MES : 1;
  const ultimoMes = ano === anoAtual ? mesAtual : 12;
  if (primeiroMes > ultimoMes) return [];
  return Array.from({ length: ultimoMes - primeiroMes + 1 }, (_, i) => primeiroMes + i);
}

export async function calcularDre(ano: number, lojaIdFiltro?: number, lojasPermitidas?: number[]): Promise<Dre> {
  const agora = new Date();
  const anoAtual = agora.getFullYear();
  const mesAtual = agora.getMonth() + 1;
  const mesesAlcancados = mesesParaCalcular(ano, anoAtual, mesAtual);

  const [resultadosPorMes, custoFixoPorMes] = await Promise.all([
    comConcorrenciaLimitada(mesesAlcancados, CONCORRENCIA_MESES, async (mes) => {
      const dataInicio = dataISO(ano, mes, 1);
      const dataFim = dataISO(ano, mes, ultimoDiaDoMes(ano, mes));
      const { vendas, resumoPedidos, gastoAdsTotal } = await listarVendasFinanceiras(
        lojaIdFiltro,
        lojasPermitidas,
        dataInicio,
        dataFim
      );

      const faturamento = vendas.reduce((s, v) => s + v.receitaTotal, 0);
      const freteVendedor = vendas.reduce((s, v) => s + (v.freteVendedorTotal ?? 0), 0);
      const custoProdutos = vendas.reduce((s, v) => s + (v.custoTotal ?? 0), 0);
      const taxaMl = vendas.reduce((s, v) => s + v.taxaMlTotal, 0);
      const imposto = vendas.reduce((s, v) => s + v.impostoTotal, 0);
      const margemContribuicao = vendas.reduce((s, v) => s + (v.margemContribuicao ?? 0), 0);

      const dreMes: DreMes = {
        mes,
        faturamento,
        freteVendedor,
        custoProdutos,
        taxaMl,
        imposto,
        cancelamentos: resumoPedidos.valorCancelado,
        margemContribuicao,
        margemPercentual: faturamento > 0 ? (margemContribuicao / faturamento) * 100 : null,
        gastoAds: gastoAdsTotal,
        custoFixoManual: 0, // preenchido depois de juntar com calcularCustoFixoPorMes
        custoFixoTotal: 0,
        lucroLiquido: 0,
        lucroPercentual: null,
      };
      return dreMes;
    }),
    calcularCustoFixoDetalhado(ano, lojaIdFiltro, lojasPermitidas),
  ]);

  // Agrega por descrição pro DRE mostrar linha por linha (ex.: "Aluguel
  // Barracão" com o valor de cada mês) — e separado por mês só pra somar
  // no custoFixoManual/custoFixoTotal de cada DreMes.
  const custoFixoPorMesMap = new Map<number, number>();
  const custoFixoPorDescricao = new Map<string, number[]>();
  for (const linha of custoFixoPorMes) {
    custoFixoPorMesMap.set(linha.mes, (custoFixoPorMesMap.get(linha.mes) ?? 0) + linha.valor);
    if (!custoFixoPorDescricao.has(linha.descricao)) custoFixoPorDescricao.set(linha.descricao, new Array(12).fill(0));
    custoFixoPorDescricao.get(linha.descricao)![linha.mes - 1] += linha.valor;
  }
  const custoFixoDetalhado: CustoFixoLinhaDre[] = Array.from(custoFixoPorDescricao.entries())
    .map(([descricao, porMes]) => ({ descricao, porMes, total: porMes.reduce((s, v) => s + v, 0) }))
    .sort((a, b) => b.total - a.total);

  const meses: DreMes[] = Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1;
    const base = resultadosPorMes.find((m) => m.mes === mes) ?? mesVazio(mes);
    const custoFixoManual = custoFixoPorMesMap.get(mes) ?? 0;
    const custoFixoTotal = base.gastoAds + custoFixoManual;
    const lucroLiquido = base.margemContribuicao - custoFixoTotal;
    return {
      ...base,
      custoFixoManual,
      custoFixoTotal,
      lucroLiquido,
      lucroPercentual: base.faturamento > 0 ? (lucroLiquido / base.faturamento) * 100 : null,
    };
  });

  const totais = meses.reduce((acc, m) => {
    acc.faturamento += m.faturamento;
    acc.freteVendedor += m.freteVendedor;
    acc.custoProdutos += m.custoProdutos;
    acc.taxaMl += m.taxaMl;
    acc.imposto += m.imposto;
    acc.cancelamentos += m.cancelamentos;
    acc.margemContribuicao += m.margemContribuicao;
    acc.gastoAds += m.gastoAds;
    acc.custoFixoManual += m.custoFixoManual;
    acc.custoFixoTotal += m.custoFixoTotal;
    acc.lucroLiquido += m.lucroLiquido;
    return acc;
  }, mesVazio(0));
  totais.margemPercentual = totais.faturamento > 0 ? (totais.margemContribuicao / totais.faturamento) * 100 : null;
  totais.lucroPercentual = totais.faturamento > 0 ? (totais.lucroLiquido / totais.faturamento) * 100 : null;

  return { ano, meses, totais, custoFixoDetalhado };
}
