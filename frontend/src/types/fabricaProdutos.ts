export type OrigemProduto = "FABRICA" | "DISTRIBUIDORA";

// Produto acabado da Fábrica Distribuidora. Custo, margem, markup e % de lucro
// vêm calculados do backend — aqui nunca são digitados nem recalculados.
export interface FabricaProduto {
  id: number;
  sku: string;
  nome: string;
  formulaId: number | null;
  formulaNome: string | null;
  embalagemId: number | null;
  embalagemNome: string | null;
  pesoKg: number;
  custoPorKgTeorico: number;
  custoPorKgReal: number;
  rendimento: number;
  lotes: number;
  custoTeorico: number;
  custoProduto: number;
  custoEmbalagem: number;
  custo: number;
  // FABRICA sai de fórmula e tem custo recalculado; DISTRIBUIDORA é comprado
  // pronto e tem custo digitado — são duas regras de custo no mesmo cadastro
  origem: OrigemProduto;
  ean: string | null;
  familia: string | null;
  custoCompra: number | null;
  precoVenda: number;
  margemContribuicao: number;
  markup: number;
  percentualLucro: number;
  // Por que o custo deu zero. Vazio quando não deu.
  //
  // Custo zero não avisa sozinho: vira margem de 100%, e margem de 100% parece
  // o melhor produto do catálogo em vez de um cadastro pela metade.
  semCusto: string[];
  ativo: boolean;
}

export interface FabricaProdutoEntrada {
  sku: string;
  nome: string;
  origem: OrigemProduto;
  ean: string | null;
  familia: string | null;
  custoCompra: number | null;
  formulaId: number | null;
  embalagemId: number | null;
  precoVenda: number;
  ativo: boolean;
}

export interface ResultadoImportacaoCatalogo {
  criados: number;
  jaExistiam: number;
  semSku: number;
  familias: number;
}

export interface DiferencaPreco {
  id: number;
  sku: string;
  nome: string;
  precoAtual: number;
  precoPlanilha: number;
  diferenca: number;
}

export interface ConferenciaCatalogo {
  diferencas: DiferencaPreco[];
  conferidos: number;
  // está no cadastro mas sumiu da planilha: produto que saiu de linha
  foraDaPlanilha: { id: number; sku: string; nome: string }[];
}
