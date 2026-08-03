import { pool } from "../db/pool";

export type TipoContato = "fornecedor" | "cliente";

export interface Contato {
  id: number;
  tipo: TipoContato;
  nome: string;
  documento: string | null;
  dadosBancarios: string | null;
  contato: string | null;
  criadoEm: string;
}

function linhaParaContato(r: Record<string, unknown>): Contato {
  return {
    id: r.id as number,
    tipo: r.tipo as TipoContato,
    nome: r.nome as string,
    documento: (r.documento as string | null) ?? null,
    dadosBancarios: (r.dados_bancarios as string | null) ?? null,
    contato: (r.contato as string | null) ?? null,
    criadoEm: r.criado_em as string,
  };
}

export async function listarContatos(tipo?: TipoContato): Promise<Contato[]> {
  const { rows } = await pool.query(
    tipo
      ? "SELECT * FROM contas_contatos WHERE tipo = $1 ORDER BY nome ASC"
      : "SELECT * FROM contas_contatos ORDER BY nome ASC",
    tipo ? [tipo] : []
  );
  return rows.map(linhaParaContato);
}

export interface NovoContato {
  tipo: TipoContato;
  nome: string;
  documento?: string | null;
  dadosBancarios?: string | null;
  contato?: string | null;
}

export async function criarContato(dados: NovoContato): Promise<Contato> {
  const { rows } = await pool.query(
    `INSERT INTO contas_contatos (tipo, nome, documento, dados_bancarios, contato)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [dados.tipo, dados.nome, dados.documento ?? null, dados.dadosBancarios ?? null, dados.contato ?? null]
  );
  return linhaParaContato(rows[0]);
}

export interface AtualizacaoContato {
  nome?: string;
  documento?: string | null;
  dadosBancarios?: string | null;
  contato?: string | null;
}

export async function atualizarContato(id: number, dados: AtualizacaoContato): Promise<Contato> {
  const campos: string[] = [];
  const valores: unknown[] = [];
  let i = 1;

  if (dados.nome !== undefined) {
    campos.push(`nome = $${i++}`);
    valores.push(dados.nome);
  }
  if (dados.documento !== undefined) {
    campos.push(`documento = $${i++}`);
    valores.push(dados.documento);
  }
  if (dados.dadosBancarios !== undefined) {
    campos.push(`dados_bancarios = $${i++}`);
    valores.push(dados.dadosBancarios);
  }
  if (dados.contato !== undefined) {
    campos.push(`contato = $${i++}`);
    valores.push(dados.contato);
  }

  if (campos.length === 0) {
    const { rows } = await pool.query("SELECT * FROM contas_contatos WHERE id = $1", [id]);
    if (!rows[0]) throw new Error("Contato não encontrado.");
    return linhaParaContato(rows[0]);
  }

  valores.push(id);
  const { rows } = await pool.query(
    `UPDATE contas_contatos SET ${campos.join(", ")} WHERE id = $${i} RETURNING *`,
    valores
  );
  if (!rows[0]) throw new Error("Contato não encontrado.");
  return linhaParaContato(rows[0]);
}

export async function excluirContato(id: number): Promise<void> {
  const { rowCount } = await pool.query("DELETE FROM contas_contatos WHERE id = $1", [id]);
  if (rowCount === 0) throw new Error("Contato não encontrado.");
}
