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
