// Cliente da Fábrica Distribuidora: lojas do grupo e clientes de fora.
// Só nome e tipo são obrigatórios — o resto se preenche aos poucos.
// `faltando` diz o que ainda impede emitir NFe pra esse cliente.
export interface FabricaCliente {
  id: number;
  nome: string;
  tipo: "LOJA" | "EXTERNO";
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
  observacao: string | null;
  ativo: boolean;
  completo: boolean;
  faltando: string[];
}

export type FabricaClienteEntrada = Omit<FabricaCliente, "id" | "completo" | "faltando">;
