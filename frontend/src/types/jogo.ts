export interface LinhaRankingJogo {
  usuarioId: number;
  nome: string;
  pontuacao: number;
  eu: boolean;
}

export interface RecordeJogo {
  usuarioId: number;
  nome: string;
  pontuacao: number;
  dia: string;
  eu: boolean;
}

export interface SemanaJogo {
  inicioSemana: string;
  fimSemana: string;
  tentativasUsadas: number;
  tentativasMaximas: number;
  ranking: LinhaRankingJogo[];
  recorde: RecordeJogo | null;
}
