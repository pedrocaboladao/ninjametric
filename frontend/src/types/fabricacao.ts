export interface MateriaPrima {
  id: number;
  nome: string;
  custoPorKg: number;
}

export interface MateriaPrimaCompra {
  id: number;
  materiaPrimaId: number;
  data: string;
  quantidadeKg: number;
  valorPago: number;
  valorFrete: number;
  custoPorKg: number;
  criadoEm: string;
}

export interface FormulaItem {
  id: number;
  tipo: "materia_prima" | "formula";
  materiaPrimaId: number | null;
  materiaPrimaNome: string | null;
  subFormulaId: number | null;
  subFormulaNome: string | null;
  custoPorKg: number;
  percentual: number;
}

export interface FormulaEmbalagem {
  id: number;
  formulaId: number;
  nome: string;
  pesoKg: number;
  custoEmbalagem: number;
  sku: string | null;
  ordem: number;
  custoProduto: number;
  custoFinal: number;
}

export interface FormulaLote {
  id: number;
  formulaId: number;
  data: string;
  pesoPrevistoKg: number;
  pesoRealKg: number;
  observacao: string | null;
  diferencaKg: number;
  diferencaPercentual: number | null;
  criadoEm: string;
}

export interface FormulaResumo {
  id: number;
  nome: string;
  pesoLoteKg: number;
  custoPorKg: number;
  custoFabricacaoTotal: number;
}

export interface Formula extends FormulaResumo {
  itens: FormulaItem[];
  embalagens: FormulaEmbalagem[];
}

export interface DadosMlSku {
  precoMedio: number;
  tarifaMedia: number;
  freteMedio: number;
  impostoMedio: number;
  qtdVendas: number;
}
