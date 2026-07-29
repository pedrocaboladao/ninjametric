export interface PerguntaPendente {
  id: number;
  lojaId: number;
  lojaNome: string;
  texto: string;
  criadoEm: string;
  comprador: string;
  produto: {
    id: string;
    titulo: string;
    preco: number;
    foto: string;
    linkMl: string;
  } | null;
}
