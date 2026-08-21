// Bens da Fábrica: maquinário, veículos — o que a empresa comprou e continua
// tendo.
//
// Comprar não é gastar: saiu dinheiro e entrou um bem que vale o mesmo tanto.
// O que empobrece é o desgaste, e é ele que entra no DRE como depreciação. A
// parcela do financiamento continua no contas a pagar (existe cheque pra pagar
// dia 17), mas não abate o lucro — senão o mês seguinte ao último cheque
// pareceria muito melhor sem uma venda a mais ter acontecido.
export interface Bem {
  id: number;
  nome: string;
  tipo: "movel" | "imovel";
  // valor de compra, cheio. Não desconta o que já foi pago: o caminhão vale o
  // que vale, quitado ou não.
  valor: number;
  dataCompra: string;
  vidaUtilAnos: number;
  observacao: string | null;
  ativo: boolean;
  // derivados
  depreciacaoMensal: number;
  mesesDepreciados: number;
  mesesTotais: number;
  depreciacaoAcumulada: number;
  valorAtual: number;
  totalmenteDepreciado: boolean;
}

export type BemEntrada = Omit<
  Bem,
  | "id"
  | "depreciacaoMensal"
  | "mesesDepreciados"
  | "mesesTotais"
  | "depreciacaoAcumulada"
  | "valorAtual"
  | "totalmenteDepreciado"
>;
