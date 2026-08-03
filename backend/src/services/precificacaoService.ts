import { listarVendasFinanceiras, normalizarSku } from "./financeiroService";

const LIMIAR_DIFERENCA_MINIMA = 5; // % — abaixo disso é ruído/arredondamento, não vale sinalizar

export interface RankingMenorPreco {
  sku: string;
  titulo: string;
  lojaId: number;
  lojaNome: string;
  precoLoja: number;
  precoReferenciaGrupo: number;
  percentualAbaixo: number;
}

export interface RankingMenorMargem {
  lojaId: number;
  lojaNome: string;
  titulo: string;
  sku: string | null;
  dataCriacao: string;
  receitaTotal: number;
  margemPercentual: number;
}

export interface RankingPrecificacao {
  menorPreco: RankingMenorPreco[];
  menorMargem: RankingMenorMargem[];
}

// Usa o preço de venda real (não o preço do anúncio) — mais simples e já
// disponível no Financeiro, sem precisar varrer o catálogo inteiro de
// anúncios de cada loja. Compara o preço médio de cada loja pra um SKU com
// o maior preço médio entre as lojas que vendem esse mesmo SKU no período
// (referência do grupo) — assim aparece quem está vendendo bem abaixo do
// que o resto do grupo pratica.
export async function calcularRankingPrecificacao(
  lojaIdFiltro?: number,
  lojasPermitidas?: number[]
): Promise<RankingPrecificacao> {
  const { vendas } = await listarVendasFinanceiras(lojaIdFiltro, lojasPermitidas);

  interface AgregadoLoja {
    somaPreco: number;
    quantidade: number;
    lojaNome: string;
    titulo: string;
  }
  const porSkuLoja = new Map<string, Map<number, AgregadoLoja>>();

  for (const v of vendas) {
    if (!v.sku) continue;
    const skuNorm = normalizarSku(v.sku);
    if (!porSkuLoja.has(skuNorm)) porSkuLoja.set(skuNorm, new Map());
    const porLoja = porSkuLoja.get(skuNorm)!;
    const atual = porLoja.get(v.lojaId) ?? { somaPreco: 0, quantidade: 0, lojaNome: v.lojaNome, titulo: v.titulo };
    atual.somaPreco += v.valorUnitario * v.quantidade;
    atual.quantidade += v.quantidade;
    porLoja.set(v.lojaId, atual);
  }

  const menorPreco: RankingMenorPreco[] = [];
  for (const [sku, porLoja] of porSkuLoja) {
    if (porLoja.size < 2) continue; // só interessa SKU vendido por mais de uma loja no período

    const precosPorLoja = Array.from(porLoja.entries()).map(([lojaId, d]) => ({
      lojaId,
      lojaNome: d.lojaNome,
      titulo: d.titulo,
      precoMedio: d.somaPreco / d.quantidade,
    }));
    const referencia = Math.max(...precosPorLoja.map((p) => p.precoMedio));

    for (const p of precosPorLoja) {
      if (p.precoMedio >= referencia) continue; // é quem está no topo do grupo, não entra no ranking
      const percentualAbaixo = ((referencia - p.precoMedio) / referencia) * 100;
      if (percentualAbaixo < LIMIAR_DIFERENCA_MINIMA) continue;
      menorPreco.push({
        sku,
        titulo: p.titulo,
        lojaId: p.lojaId,
        lojaNome: p.lojaNome,
        precoLoja: p.precoMedio,
        precoReferenciaGrupo: referencia,
        percentualAbaixo,
      });
    }
  }
  menorPreco.sort((a, b) => b.percentualAbaixo - a.percentualAbaixo);

  const menorMargem: RankingMenorMargem[] = vendas
    .filter((v): v is typeof v & { margemPercentual: number } => v.margemPercentual !== null)
    .sort((a, b) => a.margemPercentual - b.margemPercentual)
    .slice(0, 20)
    .map((v) => ({
      lojaId: v.lojaId,
      lojaNome: v.lojaNome,
      titulo: v.titulo,
      sku: v.sku,
      dataCriacao: v.dataCriacao,
      receitaTotal: v.receitaTotal,
      margemPercentual: v.margemPercentual,
    }));

  return { menorPreco: menorPreco.slice(0, 20), menorMargem };
}
