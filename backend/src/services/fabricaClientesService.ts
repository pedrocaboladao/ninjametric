import { pool } from "../db/pool";

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
}

// O que a NFe exige. Serve pra tela mostrar quem ainda está pela metade,
// em vez de descobrir isso na hora de faturar.
const OBRIGATORIOS_NFE: Array<[keyof Linha, string]> = [
  ["cnpj", "CNPJ"],
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
  const faltando = OBRIGATORIOS_NFE.filter(([campo]) => {
    const v = r[campo];
    return v === null || String(v).trim() === "";
  }).map(([, rotulo]) => rotulo);
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
    completo: faltando.length === 0,
    faltando,
  };
}

const COLUNAS = `id, nome, tipo, cnpj, inscricao_estadual, email, telefone, cep,
                 logradouro, numero, complemento, bairro, cidade, uf, observacao, ativo`;

export async function listarClientes(): Promise<FabricaCliente[]> {
  const { rows } = await pool.query<Linha>(
    `SELECT ${COLUNAS} FROM fabrica_clientes ORDER BY tipo, nome`
  );
  return rows.map(montar);
}

export async function obterCliente(id: number): Promise<FabricaCliente | null> {
  const { rows } = await pool.query<Linha>(
    `SELECT ${COLUNAS} FROM fabrica_clientes WHERE id = $1`,
    [id]
  );
  return rows[0] ? montar(rows[0]) : null;
}

function valores(e: ClienteEntrada) {
  return [
    e.nome, e.tipo, e.cnpj, e.inscricaoEstadual, e.email, e.telefone, e.cep,
    e.logradouro, e.numero, e.complemento, e.bairro, e.cidade, e.uf, e.observacao, e.ativo,
  ];
}

export async function criarCliente(e: ClienteEntrada): Promise<{ id: number }> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO fabrica_clientes
       (nome, tipo, cnpj, inscricao_estadual, email, telefone, cep,
        logradouro, numero, complemento, bairro, cidade, uf, observacao, ativo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING id`,
    valores(e)
  );
  return { id: rows[0].id };
}

export async function atualizarCliente(id: number, e: ClienteEntrada): Promise<void> {
  await pool.query(
    `UPDATE fabrica_clientes SET
       nome = $2, tipo = $3, cnpj = $4, inscricao_estadual = $5, email = $6, telefone = $7,
       cep = $8, logradouro = $9, numero = $10, complemento = $11, bairro = $12,
       cidade = $13, uf = $14, observacao = $15, ativo = $16
     WHERE id = $1`,
    [id, ...valores(e)]
  );
}

export async function excluirCliente(id: number): Promise<void> {
  await pool.query("DELETE FROM fabrica_clientes WHERE id = $1", [id]);
}
