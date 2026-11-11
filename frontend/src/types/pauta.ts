export type StatusPauta = "sugerido" | "selecionado" | "discutido" | "adiado";

export interface PautaItem {
  id: number;
  titulo: string;
  descricao: string | null;
  lojaId: number | null;
  lojaNome: string | null;
  area: string | null;
  status: StatusPauta;
  reuniaoData: string | null;
  decisao: string | null;
  criadoPorId: number;
  criadoPorNome: string;
  criadoEm: string;
  atualizadoEm: string;
  apoios: number;
  apoiadoPorMim: boolean;
}
