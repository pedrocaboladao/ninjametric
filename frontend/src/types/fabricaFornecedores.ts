// Fornecedor da Fábrica Distribuidora.
//
// O nome era digitado em cada conta e o estrago apareceu na primeira carga:
// "METALLOG" e "MATALLOG BRASIL" são a mesma empresa. A conta continua
// guardando o nome como texto — o cadastro é a fonte da busca, pra ele sair
// sempre igual.
export interface Fornecedor {
  id: number;
  nome: string;
  cnpj: string | null;
  inscricaoEstadual: string | null;
  email: string | null;
  telefone: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  // o que ele fornece: sugere a categoria da conta na hora de lançar
  categoriaPadrao: string | null;
  observacao: string | null;
  ativo: boolean;
  // derivados: quantas contas já foram lançadas com este nome
  contas: number;
  total: number;
}

export type FornecedorEntrada = Omit<Fornecedor, "id" | "contas" | "total">;

// quem aparece nas contas mas ainda não foi cadastrado
export interface FornecedorPendente {
  nome: string;
  contas: number;
  total: number;
  categoria: string | null;
}
