export interface MateriaPrima {
  id: number;
  nome: string;
  custoPorKg: number;
}

export interface FormulaItem {
  id: number;
  materiaPrimaId: number;
  materiaPrimaNome: string;
  custoPorKg: number;
  percentual: number;
}

export interface FormulaResumo {
  id: number;
  nome: string;
  sku: string | null;
  pesoLoteKg: number;
  custoEmbalagem: number;
  custoFabricacao: number;
}

export interface Formula extends FormulaResumo {
  itens: FormulaItem[];
}

export interface DadosMlSku {
  precoMedio: number;
  tarifaMedia: number;
  freteMedio: number;
  impostoMedio: number;
  qtdVendas: number;
}
