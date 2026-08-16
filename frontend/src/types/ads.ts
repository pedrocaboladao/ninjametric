export interface CampanhaAds {
  lojaId: number;
  lojaNome: string;
  campanhaId: number;
  nome: string;
  status: string;
  orcamento: number;
  acosMeta: number;
  acosMetaAnterior: number | null;
  cliques: number;
  impressoes: number;
  custo: number;
  cpc: number;
  vendasDiretas: number;
  vendasIndiretas: number;
  vendasTotais: number;
  acos: number;
}

export interface ReceitaRealCampanha {
  lojaId: number;
  campanhaId: number;
  receitaTotalReal: number;
  margemReal: number;
  acosIdeal: number | null;
}

// Diagnóstico de esgotamento de orçamento diário — janela fixa dos últimos
// 14 dias completos (ver rota /api/ads/diagnostico-orcamento).
export interface DiagnosticoOrcamento {
  lojaId: number;
  lojaNome: string;
  campanhaId: number;
  nome: string;
  orcamento: number;
  acosMeta: number;
  acosPeriodo: number | null;
  diasAnalisados: number;
  diasEsgotados: number;
  utilizacaoMedia: number;
  custoTotal: number;
  vendasTotais: number;
}
