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
  custoPorKg: number;
  custoProduto: number;
  custoEmbalagem: number;
  custo: number;
  precoVenda: number;
  margemContribuicao: number;
  markup: number;
  percentualLucro: number;
  ativo: boolean;
}

export interface FabricaProdutoEntrada {
  sku: string;
  nome: string;
  formulaId: number | null;
  embalagemId: number | null;
  precoVenda: number;
  ativo: boolean;
}
