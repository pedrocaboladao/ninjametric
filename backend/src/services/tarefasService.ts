import { pool } from "../db/pool";

export interface Cartao {
  id: number;
  colunaId: number;
  titulo: string;
  concluido: boolean;
  ordem: number;
}

export interface Coluna {
  id: number;
  nome: string;
  especial: string | null;
  cor: string | null;
  ordem: number;
  cartoes: Cartao[];
}

interface LinhaCartao {
  id: number;
  coluna_id: number;
  titulo: string;
  concluido: boolean;
  ordem: number;
}

function linhaParaCartao(r: LinhaCartao): Cartao {
  return { id: r.id, colunaId: r.coluna_id, titulo: r.titulo, concluido: r.concluido, ordem: r.ordem };
}

export async function listarQuadro(): Promise<Coluna[]> {
  const { rows: colunasRows } = await pool.query(
    "SELECT id, nome, especial, cor, ordem FROM tarefas_colunas ORDER BY ordem, id"
  );
  const { rows: cartoesRows } = await pool.query(
    "SELECT id, coluna_id, titulo, concluido, ordem FROM tarefas_cartoes WHERE arquivado = false ORDER BY ordem, id"
  );

  const cartoesPorColuna = new Map<number, Cartao[]>();
  for (const r of cartoesRows) {
    const c = linhaParaCartao(r);
    const lista = cartoesPorColuna.get(c.colunaId) ?? [];
    lista.push(c);
    cartoesPorColuna.set(c.colunaId, lista);
  }

  return colunasRows.map((c) => ({
    id: c.id,
    nome: c.nome,
    especial: c.especial,
    cor: c.cor,
    ordem: c.ordem,
    cartoes: cartoesPorColuna.get(c.id) ?? [],
  }));
}

export async function criarColuna(nome: string): Promise<Coluna> {
  const { rows } = await pool.query(
    "SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM tarefas_colunas"
  );
  const ordem = rows[0].proxima;
  const { rows: inseridas } = await pool.query(
    "INSERT INTO tarefas_colunas (nome, ordem) VALUES ($1, $2) RETURNING id, nome, especial, cor, ordem",
    [nome, ordem]
  );
  return { ...inseridas[0], cartoes: [] };
}

async function garantirColunaNaoEspecial(id: number, acao: string): Promise<void> {
  const { rows } = await pool.query("SELECT especial FROM tarefas_colunas WHERE id = $1", [id]);
  if (rows[0]?.especial) {
    throw new Error(`Não é possível ${acao} a coluna "Concluídos".`);
  }
}

export async function renomearColuna(id: number, nome: string): Promise<void> {
  await garantirColunaNaoEspecial(id, "renomear");
  await pool.query("UPDATE tarefas_colunas SET nome = $1 WHERE id = $2", [nome, id]);
}

export async function excluirColuna(id: number): Promise<void> {
  await garantirColunaNaoEspecial(id, "excluir");
  await pool.query("DELETE FROM tarefas_colunas WHERE id = $1", [id]);
}

export async function mudarCorColuna(id: number, cor: string | null): Promise<void> {
  await pool.query("UPDATE tarefas_colunas SET cor = $1 WHERE id = $2", [cor, id]);
}

export async function criarCartao(colunaId: number, titulo: string): Promise<Cartao> {
  const { rows } = await pool.query(
    "SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM tarefas_cartoes WHERE coluna_id = $1",
    [colunaId]
  );
  const ordem = rows[0].proxima;
  const { rows: inseridos } = await pool.query(
    "INSERT INTO tarefas_cartoes (coluna_id, titulo, ordem) VALUES ($1, $2, $3) RETURNING id, coluna_id, titulo, concluido, ordem",
    [colunaId, titulo, ordem]
  );
  return linhaParaCartao(inseridos[0]);
}

export interface AtualizacaoCartao {
  titulo?: string;
  concluido?: boolean;
  colunaId?: number;
  ordem?: number;
  arquivado?: boolean;
}

export async function atualizarCartao(id: number, dados: AtualizacaoCartao): Promise<void> {
  const campos: string[] = [];
  const valores: unknown[] = [];
  let i = 1;

  if (dados.titulo !== undefined) {
    campos.push(`titulo = $${i++}`);
    valores.push(dados.titulo);
  }
  if (dados.concluido !== undefined) {
    campos.push(`concluido = $${i++}`);
    valores.push(dados.concluido);
  }
  if (dados.colunaId !== undefined) {
    campos.push(`coluna_id = $${i++}`);
    valores.push(dados.colunaId);
  }
  if (dados.ordem !== undefined) {
    campos.push(`ordem = $${i++}`);
    valores.push(dados.ordem);
  }
  if (dados.arquivado !== undefined) {
    campos.push(`arquivado = $${i++}`);
    valores.push(dados.arquivado);
  }

  if (campos.length === 0) return;
  campos.push(`atualizado_em = now()`);
  valores.push(id);

  await pool.query(`UPDATE tarefas_cartoes SET ${campos.join(", ")} WHERE id = $${i}`, valores);
}

export async function reindexarColuna(colunaId: number, idsEmOrdem: number[]): Promise<void> {
  await Promise.all(
    idsEmOrdem.map((cartaoId, ordem) =>
      pool.query("UPDATE tarefas_cartoes SET coluna_id = $1, ordem = $2 WHERE id = $3", [colunaId, ordem, cartaoId])
    )
  );
}

export async function excluirCartao(id: number): Promise<void> {
  await pool.query("DELETE FROM tarefas_cartoes WHERE id = $1", [id]);
}

export async function obterColunaEspecial(): Promise<{ id: number } | null> {
  const { rows } = await pool.query("SELECT id FROM tarefas_colunas WHERE especial = 'concluidos'");
  return rows[0] ?? null;
}

export async function arquivarTodosConcluidos(): Promise<void> {
  const especial = await obterColunaEspecial();
  if (!especial) return;
  await pool.query("UPDATE tarefas_cartoes SET arquivado = true WHERE coluna_id = $1", [especial.id]);
}

export interface CartaoArquivado extends Cartao {
  colunaNomeOriginal: string;
}

export async function listarArquivados(): Promise<CartaoArquivado[]> {
  const { rows } = await pool.query(
    `SELECT tc.id, tc.coluna_id, tc.titulo, tc.concluido, tc.ordem, col.nome AS coluna_nome
     FROM tarefas_cartoes tc
     JOIN tarefas_colunas col ON col.id = tc.coluna_id
     WHERE tc.arquivado = true
     ORDER BY tc.atualizado_em DESC`
  );
  return rows.map((r) => ({ ...linhaParaCartao(r), colunaNomeOriginal: r.coluna_nome }));
}

export async function restaurarCartao(id: number, colunaId: number): Promise<void> {
  const { rows } = await pool.query(
    "SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM tarefas_cartoes WHERE coluna_id = $1",
    [colunaId]
  );
  await pool.query("UPDATE tarefas_cartoes SET arquivado = false, coluna_id = $1, ordem = $2 WHERE id = $3", [
    colunaId,
    rows[0].proxima,
    id,
  ]);
}
