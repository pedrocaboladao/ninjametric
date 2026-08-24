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
  // Quem paga por esta loja. Nulo = ela mesma paga.
  //
  // 22 lojas vendem, mas quem fecha a conta são 10: Cores Certas, Hangar,
  // Inga Collors e Perpétua vendem no próprio nome e a cobrança vai inteira
  // para a Catedral Impermeabilizantes.
  clientePaiId: number | null;
  completo: boolean;
  faltando: string[];
}

// clientePaiNome e filhas são derivados: vêm do servidor, não se digita
export interface FabricaCliente {
  clientePaiNome: string | null;
  filhas: number;
}

export type FabricaClienteEntrada = Omit<
  FabricaCliente,
  "id" | "completo" | "faltando" | "clientePaiNome" | "filhas"
>;
