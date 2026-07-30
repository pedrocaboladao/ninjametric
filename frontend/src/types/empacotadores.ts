export interface Empacotador {
  id: number;
  numero: number;
  nome: string;
  metaDiaria: number | null;
}

export interface ItemRanking extends Empacotador {
  totalPacotes: number;
}

export interface LancamentoDia {
  empacotadorId: number;
  numero: number;
  nome: string;
  pacotes: number;
}

export interface HistoricoDia {
  data: string;
  pacotes: number;
}

export interface ResumoBonus {
  empacotadorId: number;
  numero: number;
  nome: string;
  metaDiaria: number | null;
  totalPacotes: number;
  bonusGerado: number;
  bonusPago: number;
  bonusPendente: number;
}

export interface DetalheDiaBonus {
  data: string;
  pacotes: number;
  meta: number | null;
  excedente: number;
  bonusDoDia: number;
}

export interface ItemFechamento {
  empacotadorId: number;
  numero: number;
  nome: string;
  valor: number;
}

export interface Fechamento {
  id: number;
  criadoEm: string;
  total: number;
  itens: ItemFechamento[];
}
