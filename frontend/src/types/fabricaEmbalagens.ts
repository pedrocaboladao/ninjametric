// Cadastro de embalagem da Fábrica Distribuidora: o balde, a bombona, o galão.
// Lugar único do custo — antes disso o preço era um número digitado dentro de
// cada fórmula, repetido em dezenas de lugares.
//
// O estoque aqui é derivado, nunca digitado: comprado − consumido + ajustes.
export interface FabricaEmbalagem {
  id: number;
  nome: string;
  pesoKg: number;
  custoUnitario: number;
  estoqueMinimo: number;
  ativo: boolean;
  // 18, 16 e 15 kg são o mesmo balde físico — aponta pro cadastro raiz
  equivaleAId: number | null;
  comprado: number;
  consumido: number;
  ajustes: number;
  estoque: number;
  abaixoDoMinimo: boolean;
  formulasLigadas: number;
}

export type FabricaEmbalagemEntrada = Pick<
  FabricaEmbalagem,
  "nome" | "pesoKg" | "custoUnitario" | "estoqueMinimo" | "ativo" | "equivaleAId"
>;

// Um movimento de embalagem: compra (entra) ou ajuste (inventário, quebra).
export interface MovimentoEmbalagem {
  id: number;
  embalagemId: number;
  embalagemNome: string;
  data: string;
  quantidade: number;
  custoUnitario: number | null;
  texto: string | null;
}

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
