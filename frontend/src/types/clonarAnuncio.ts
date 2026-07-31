export interface Loja {
  id: number;
  nome: string;
}

export interface PreviewAnuncio {
  itemOriginalId: string;
  tituloOriginal: string;
  categoriaId: string;
  categoriaNome: string;
  preco: number;
  moeda: string;
  quantidadeDisponivel: number;
  condicao: string;
  siteId: string;
  fotos: string[];
  numAtributos: number;
  numVariacoes: number;
  variacoes: Array<{ index: number; resumo: string }>;
  frete: { modo: string; freteGratis: boolean; retiradaLocal: boolean };
  descricao: string;
  linkOriginal: string;
  lojaOrigemId: number;
}

export interface ResultadoClone {
  novoItemId: string;
  permalink: string;
  avisos?: string[];
}

export const TIPOS_ANUNCIO = [
  { value: "gold_special", label: "Clássico" },
  { value: "gold_pro", label: "Premium" },
] as const;
