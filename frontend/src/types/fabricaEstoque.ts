// Estoque de matéria-prima. O saldo nunca é digitado nem guardado: sai de
// comprado − consumido + ajustes, recalculado a cada leitura.
export interface EstoqueMateriaPrima {
  materiaPrimaId: number;
  nome: string;
  custoPorKg: number;
  comprado: number;
  consumido: number;
  ajustes: number;
  saldo: number;
  estoqueMinimo: number;
  abaixoDoMinimo: boolean;
  valorEmEstoque: number;
}

export interface AjusteEstoque {
  id: number;
  materiaPrimaId: number;
  materiaPrimaNome: string;
  data: string;
  quantidadeKg: number;
  motivo: string | null;
  criadoEm: string;
}

// Quanto dá pra fabricar de cada fórmula com o estoque de hoje, e qual
// insumo trava — o que acaba primeiro, não o que está mais baixo em quilos.
export interface CapacidadeFormula {
  formulaId: number;
  formulaNome: string;
  maximoKg: number;
  gargaloNome: string | null;
  gargaloSaldo: number;
  gargaloFracao: number;
}
