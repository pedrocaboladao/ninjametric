export interface Empacotador {
  id: number;
  numero: number;
  nome: string;
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
