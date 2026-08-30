import { pool } from "../db/pool";
import { dataIso } from "./fabricaData";

// Cliente da Fábrica Distribuidora: as lojas do grupo e clientes de fora.
//
// Só `nome` e `tipo` são obrigatórios — o resto é preenchido aos poucos. Os
// campos fiscais e de endereço existem desde já porque a fábrica pretende
// emitir NFe: é mais barato ter a coluna vazia do que migrar depois com 20
// cadastros em uso.
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
  // Vinte e duas lojas vendem, mas quem fecha a conta sao dez. Cores Certas,
  // Hangar, Inga Collors e Perpetua vendem no proprio nome e a cobranca vai
  // inteira pra Catedral Impermeabilizantes.
  clientePaiId: number | null;
  clientePaiNome: string | null;
  // quantas lojas pagam por esta — so tem valor em quem e pai
  filhas: number;
  // como a loja é chamada no dia a dia; entra na busca da tela
  apelidos: string[];
  pessoaFisica: boolean;
  naCobranca: boolean;
  // Último dia em que o pai paga por esta loja. Nulo = paga sempre.
  //
  // Vira a chave sem reescrever o passado: o que a loja comprou até esta data
  // continua cobrado do pai, e o que vier depois é cobrado dela.
  cobrancaPaiAte: string | null;
  // quanto falta do cadastro pra conseguir emitir nota
  completo: boolean;
  faltando: string[];
}

export interface ClienteEntrada {
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
  clientePaiId: number | null;
  // gente, não empresa: o documento é CPF e não existe inscrição estadual
  pessoaFisica: boolean;
  // entra no ciclo semanal de cobrança
  naCobranca: boolean;
  // último dia em que o pai paga por ela; nulo = sempre
  cobrancaPaiAte: string | null;
}

interface Linha {
  id: number;
  nome: string;
  tipo: string;
  cnpj: string | null;
  inscricao_estadual: string | null;
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
  cliente_pai_id: number | null;
  cliente_pai_nome: string | null;
  filhas: string | null;
  apelidos: string[] | null;
  pessoa_fisica: boolean;
  na_cobranca: boolean;
  cobranca_pai_ate: string | null;
}

// O que a NFe exige. Serve pra tela mostrar quem ainda está pela metade,
// em vez de descobrir isso na hora de faturar.
const OBRIGATORIOS_NFE: Array<[keyof Linha, string]> = [
  ["cnpj", "documento"],
  ["email", "e-mail"],
  ["telefone", "telefone"],
  ["cep", "CEP"],
  ["logradouro", "logradouro"],
  ["numero", "número"],
  ["bairro", "bairro"],
  ["cidade", "cidade"],
  ["uf", "UF"],
];

function montar(r: Linha): FabricaCliente {
  // pessoa física não tem CNPJ e nunca vai ter: o que falta nela é CPF
  const documento = r.pessoa_fisica ? "CPF" : "CNPJ";
  const faltando = OBRIGATORIOS_NFE.filter(([campo]) => {
    const v = r[campo];
    return v === null || String(v).trim() === "";
  }).map(([, rotulo]) => (rotulo === "documento" ? documento : rotulo));
  return {
    id: r.id,
    nome: r.nome,
    tipo: r.tipo === "EXTERNO" ? "EXTERNO" : "LOJA",
    cnpj: r.cnpj,
    inscricaoEstadual: r.inscricao_estadual,
    email: r.email,
    telefone: r.telefone,
    cep: r.cep,
    logradouro: r.logradouro,
    numero: r.numero,
    complemento: r.complemento,
    bairro: r.bairro,
    cidade: r.cidade,
    uf: r.uf,
    observacao: r.observacao,
    ativo: r.ativo,
    clientePaiId: r.cliente_pai_id,
    clientePaiNome: r.cliente_pai_nome,
    filhas: Number(r.filhas ?? 0),
    apelidos: r.apelidos ?? [],
    pessoaFisica: r.pessoa_fisica === true,
    naCobranca: r.na_cobranca !== false,
    cobrancaPaiAte: r.cobranca_pai_ate ? dataIso(r.cobranca_pai_ate) : null,
    completo: faltando.length === 0,
    faltando,
  };
}

const COLUNAS = `c.id, c.nome, c.tipo, c.cnpj, c.inscricao_estadual, c.email, c.telefone,
                 c.cep, c.logradouro, c.numero, c.complemento, c.bairro, c.cidade, c.uf,
                 c.observacao, c.ativo, c.cliente_pai_id, c.pessoa_fisica, c.na_cobranca, c.cobranca_pai_ate,
                 p.nome AS cliente_pai_nome,
                 (SELECT COUNT(*) FROM fabrica_clientes f WHERE f.cliente_pai_id = c.id) AS filhas,
                 (SELECT COALESCE(ARRAY_AGG(a.apelido ORDER BY a.id), '{}')
                    FROM fabrica_cliente_apelidos a WHERE a.cliente_id = c.id) AS apelidos`;

const DE = `FROM fabrica_clientes c LEFT JOIN fabrica_clientes p ON p.id = c.cliente_pai_id`;

export async function listarClientes(): Promise<FabricaCliente[]> {
  const { rows } = await pool.query<Linha>(
    `SELECT ${COLUNAS} ${DE} ORDER BY c.tipo, c.nome`
  );
  return rows.map(montar);
}

export async function obterCliente(id: number): Promise<FabricaCliente | null> {
  const { rows } = await pool.query<Linha>(`SELECT ${COLUNAS} ${DE} WHERE c.id = $1`, [id]);
  return rows[0] ? montar(rows[0]) : null;
}

function valores(e: ClienteEntrada) {
  return [
    e.nome, e.tipo, e.cnpj, e.inscricaoEstadual, e.email, e.telefone, e.cep,
    e.logradouro, e.numero, e.complemento, e.bairro, e.cidade, e.uf, e.observacao, e.ativo,
    e.clientePaiId, e.pessoaFisica, e.naCobranca, e.cobrancaPaiAte,
  ];
}

export async function criarCliente(e: ClienteEntrada): Promise<{ id: number }> {
  await validarPai(null, e.clientePaiId);
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO fabrica_clientes
       (nome, tipo, cnpj, inscricao_estadual, email, telefone, cep,
        logradouro, numero, complemento, bairro, cidade, uf, observacao, ativo,
        cliente_pai_id, pessoa_fisica, na_cobranca, cobranca_pai_ate)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::date)
     RETURNING id`,
    valores(e)
  );
  return { id: rows[0].id };
}

// Pai de si mesmo, ou ciclo A->B->A, faria o agrupamento do fechamento rodar
// pra sempre procurando quem paga.
async function validarPai(id: number | null, paiId: number | null): Promise<void> {
  if (paiId === null) return;
  if (id !== null && paiId === id) throw new Error("Um cliente não pode pagar por si mesmo.");
  let atual: number | null = paiId;
  const visto = new Set<number>(id === null ? [] : [id]);
  while (atual !== null) {
    if (visto.has(atual)) throw new Error("Isso criaria um ciclo entre as contas pai.");
    visto.add(atual);
    // tipo anotado à mão: `atual` alimenta a consulta e recebe dela, e a
    // inferência do TS entra em círculo
    const r: { rows: Array<{ cliente_pai_id: number | null }> } = await pool.query(
      "SELECT cliente_pai_id FROM fabrica_clientes WHERE id = $1",
      [atual]
    );
    if (!r.rows[0]) throw new Error("Conta pai não encontrada.");
    atual = r.rows[0].cliente_pai_id;
  }
}

export async function atualizarCliente(id: number, e: ClienteEntrada): Promise<void> {
  await validarPai(id, e.clientePaiId);
  await pool.query(
    `UPDATE fabrica_clientes SET
       nome = $2, tipo = $3, cnpj = $4, inscricao_estadual = $5, email = $6, telefone = $7,
       cep = $8, logradouro = $9, numero = $10, complemento = $11, bairro = $12,
       cidade = $13, uf = $14, observacao = $15, ativo = $16, cliente_pai_id = $17,
       pessoa_fisica = $18, na_cobranca = $19, cobranca_pai_ate = $20::date
     WHERE id = $1`,
    [id, ...valores(e)]
  );
}

export async function excluirCliente(id: number): Promise<void> {
  await pool.query("DELETE FROM fabrica_clientes WHERE id = $1", [id]);
}
