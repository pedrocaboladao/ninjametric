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
  pessoaFisica: boolean;
  // Entra no ciclo semanal de cobrança.
  //
  // Outra pergunta que "está ativo": quem compra esporádico e paga na hora não
  // faz parte da terça-feira, mas continua sendo cliente.
  naCobranca: boolean;
  // Último dia em que o pai paga por esta loja. Nulo = paga sempre.
  //
  // Vira a chave sem reescrever o passado: o que a loja comprou até esta data
  // continua na conta do pai, o que vier depois é cobrado dela.
  cobrancaPaiAte: string | null;
  completo: boolean;
  faltando: string[];
}

// clientePaiNome, filhas e apelidos são derivados: vêm do servidor, não se digita
export interface FabricaCliente {
  clientePaiNome: string | null;
  filhas: number;
  // Como a loja é chamada no dia a dia e como ela chega na venda importada.
  // Entra na busca: quem digita "truck 3" não sabe que a razão social é
  // W. L. P DOS SANTOS JUNIOR LTDA.
  apelidos: string[];
}

// Cliente externo que é gente, não empresa: o documento é CPF e não existe
// inscrição estadual. Sem isso a tela cobrava CNPJ de quem nunca vai ter um.

export type FabricaClienteEntrada = Omit<
  FabricaCliente,
  "id" | "completo" | "faltando" | "clientePaiNome" | "filhas" | "apelidos"
>;
