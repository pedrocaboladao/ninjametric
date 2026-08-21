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
  // água sai da torneira: custa, mas não se compra nem se conta
  controlaEstoque: boolean;
}

// Conta de consumo (água) virando preço por quilo: o valor do mês dividido
// pelos quilos que os lotes daquele mês realmente usaram.
export interface ContaInsumo {
  // é uma linha do Contas a pagar da fábrica: lançamento único, dois usos
  contaId: number;
  materiaPrimaId: number;
  materiaPrimaNome: string;
  descricao: string;
  competencia: string;
  valor: number;
  percentualProducao: number;
  observacao: string | null;
  kgConsumidos: number;
  custoPorKg: number;
  custoAplicado: number;
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
  // null = nenhum insumo controlado limita esta fórmula
  maximoKg: number | null;
  gargaloNome: string | null;
  gargaloSaldo: number;
  gargaloFracao: number;
}
