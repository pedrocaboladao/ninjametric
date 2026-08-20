// Cadastro de embalagem da Fábrica Distribuidora: o balde, a bombona, o galão.
// Lugar único do custo e do estoque — antes disso o preço era um número
// digitado dentro de cada fórmula, repetido em dezenas de lugares.
export interface FabricaEmbalagem {
  id: number;
  nome: string;
  pesoKg: number;
  custoUnitario: number;
  estoque: number;
  estoqueMinimo: number;
  ativo: boolean;
  abaixoDoMinimo: boolean;
  formulasLigadas: number;
}

export type FabricaEmbalagemEntrada = Omit<
  FabricaEmbalagem,
  "id" | "abaixoDoMinimo" | "formulasLigadas"
>;

// Uma embalagem que existe dentro de uma fórmula, e a qual cadastro ela aponta.
// É o "de-para": a fórmula tem um "Balde 18kg" digitado; este vínculo diz que
// ele é o cadastro nº 3.
export interface VinculoEmbalagem {
  id: number;
  formulaId: number;
  formulaNome: string;
  nome: string;
  pesoKg: number;
  custoDigitado: number;
  fabricaEmbalagemId: number | null;
  fabricaEmbalagemNome: string | null;
}
