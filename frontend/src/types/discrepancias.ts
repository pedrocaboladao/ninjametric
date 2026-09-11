export interface Discrepancia {
  id: number;
  usuarioId: number | null;
  usuarioNome: string | null;
  lojaId: number | null;
  lojaNome: string | null;
  link: string;
  mlb: string;
  sku: string | null;
  titulo: string | null;
  preco: number | null;
  criadoEm: string;
}

export interface RankingUsuarioDiscrepancias {
  usuarioId: number;
  nome: string;
  quantidade: number;
}

export interface LojaMaisDiscrepante {
  lojaId: number;
  nome: string;
  quantidade: number;
}

export interface RankingDiscrepancias {
  usuarios: RankingUsuarioDiscrepancias[];
  lojaMaisDiscrepante: LojaMaisDiscrepante | null;
}
