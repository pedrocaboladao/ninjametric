// O que acontece com o produto — nao o que ele e.
//
// Duas perguntas diferentes moravam num campo so: "eu vendo isso?" e "isso vai
// pro Mercado Livre?". Pro saco de lixo as respostas divergem — vende sim,
// anuncia nao — e ele nao cabia em nenhum dos dois valores. Marcado REVENDA, a
// conferencia cobrava ele no SKU MASTER pra sempre; marcado INSUMO, mentia:
// foram R$ 24.242,40 vendidos em agosto.
//
//   REVENDA          vende e anuncia no ML   -> pertence ao SKU MASTER
//   CONSUMO_LOJA     vende so pras lojas     -> fora do master, tem preco
//   INSUMO           a fabrica consome       -> fora do master, sem venda
export type TipoProduto = "REVENDA" | "CONSUMO_LOJA" | "INSUMO";

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
  // REVENDA vira anúncio no Mercado Livre; INSUMO a expedição consome — caixa,
  // saco, fita. É por isso que insumo não pertence ao SKU MASTER.
  tipo: TipoProduto;
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
  tipo: TipoProduto;
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
