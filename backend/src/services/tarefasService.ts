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

const COLUNAS_PADRAO = ["Em andamento", "Hangar", "Catedral Impermeabilizantes", "Inga Collors", "Perpétua"];

async function garantirColunasPadrao(usuarioId: number): Promise<void> {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS total FROM tarefas_colunas WHERE usuario_id = $1", [
    usuarioId,
  ]);
  if (rows[0].total > 0) return;

  for (let i = 0; i < COLUNAS_PADRAO.length; i++) {
    await pool.query("INSERT INTO tarefas_colunas (usuario_id, nome, ordem) VALUES ($1, $2, $3)", [
      usuarioId,
      COLUNAS_PADRAO[i],
      i,
    ]);
  }
  await pool.query(
    `INSERT INTO tarefas_colunas (usuario_id, nome, especial, ordem)
     VALUES ($1, 'Concluídos', 'concluidos', $2)
     ON CONFLICT (usuario_id, especial) WHERE especial IS NOT NULL DO NOTHING`,
    [usuarioId, COLUNAS_PADRAO.length]
  );
}

export async function listarQuadro(usuarioId: number): Promise<Coluna[]> {
  await garantirColunasPadrao(usuarioId);

  const { rows: colunasRows } = await pool.query(
    "SELECT id, nome, especial, cor, ordem FROM tarefas_colunas WHERE usuario_id = $1 ORDER BY ordem, id",
    [usuarioId]
  );
  const { rows: cartoesRows } = await pool.query(
    `SELECT tc.id, tc.coluna_id, tc.titulo, tc.concluido, tc.ordem
     FROM tarefas_cartoes tc
     JOIN tarefas_colunas col ON col.id = tc.coluna_id
     WHERE col.usuario_id = $1 AND tc.arquivado = false
     ORDER BY tc.ordem, tc.id`,
    [usuarioId]
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

export async function criarColuna(usuarioId: number, nome: string): Promise<Coluna> {
  const { rows } = await pool.query(
    "SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM tarefas_colunas WHERE usuario_id = $1",
    [usuarioId]
  );
  const ordem = rows[0].proxima;
  const { rows: inseridas } = await pool.query(
    "INSERT INTO tarefas_colunas (usuario_id, nome, ordem) VALUES ($1, $2, $3) RETURNING id, nome, especial, cor, ordem",
    [usuarioId, nome, ordem]
  );
  return { ...inseridas[0], cartoes: [] };
}

async function garantirColunaDoUsuario(id: number, usuarioId: number): Promise<{ especial: string | null }> {
  const { rows } = await pool.query("SELECT especial FROM tarefas_colunas WHERE id = $1 AND usuario_id = $2", [
    id,
    usuarioId,
  ]);
  if (!rows[0]) {
    throw new Error("Coluna não encontrada.");
  }
  return rows[0];
}

async function garantirColunaNaoEspecial(id: number, usuarioId: number, acao: string): Promise<void> {
  const coluna = await garantirColunaDoUsuario(id, usuarioId);
  if (coluna.especial) {
    throw new Error(`Não é possível ${acao} a coluna "Concluídos".`);
  }
}

export async function renomearColuna(id: number, usuarioId: number, nome: string): Promise<void> {
  await garantirColunaNaoEspecial(id, usuarioId, "renomear");
  await pool.query("UPDATE tarefas_colunas SET nome = $1 WHERE id = $2", [nome, id]);
}

export async function excluirColuna(id: number, usuarioId: number): Promise<void> {
  await garantirColunaNaoEspecial(id, usuarioId, "excluir");
  await pool.query("DELETE FROM tarefas_colunas WHERE id = $1", [id]);
}

export async function mudarCorColuna(id: number, usuarioId: number, cor: string | null): Promise<void> {
  await garantirColunaDoUsuario(id, usuarioId);
  await pool.query("UPDATE tarefas_colunas SET cor = $1 WHERE id = $2", [cor, id]);
}

export async function criarCartao(usuarioId: number, colunaId: number, titulo: string): Promise<Cartao> {
  await garantirColunaDoUsuario(colunaId, usuarioId);
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

async function garantirCartaoDoUsuario(id: number, usuarioId: number): Promise<void> {
  const { rows } = await pool.query(
    `SELECT tc.id FROM tarefas_cartoes tc
     JOIN tarefas_colunas col ON col.id = tc.coluna_id
     WHERE tc.id = $1 AND col.usuario_id = $2`,
    [id, usuarioId]
  );
  if (!rows[0]) {
    throw new Error("Cartão não encontrado.");
  }
}

export async function atualizarCartao(id: number, usuarioId: number, dados: AtualizacaoCartao): Promise<void> {
  await garantirCartaoDoUsuario(id, usuarioId);
  if (dados.colunaId !== undefined) {
    await garantirColunaDoUsuario(dados.colunaId, usuarioId);
  }

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

export async function reindexarColuna(colunaId: number, usuarioId: number, idsEmOrdem: number[]): Promise<void> {
  await garantirColunaDoUsuario(colunaId, usuarioId);
  await Promise.all(
    idsEmOrdem.map((cartaoId, ordem) =>
      pool.query(
        `UPDATE tarefas_cartoes SET coluna_id = $1, ordem = $2
         WHERE id = $3 AND coluna_id IN (SELECT id FROM tarefas_colunas WHERE usuario_id = $4)`,
        [colunaId, ordem, cartaoId, usuarioId]
      )
    )
  );
}

export async function excluirCartao(id: number, usuarioId: number): Promise<void> {
  await garantirCartaoDoUsuario(id, usuarioId);
  await pool.query("DELETE FROM tarefas_cartoes WHERE id = $1", [id]);
}

async function obterColunaEspecial(usuarioId: number): Promise<{ id: number } | null> {
  const { rows } = await pool.query("SELECT id FROM tarefas_colunas WHERE especial = 'concluidos' AND usuario_id = $1", [
    usuarioId,
  ]);
  return rows[0] ?? null;
}

export async function arquivarTodosConcluidos(usuarioId: number): Promise<void> {
  const especial = await obterColunaEspecial(usuarioId);
  if (!especial) return;
  await pool.query("UPDATE tarefas_cartoes SET arquivado = true WHERE coluna_id = $1", [especial.id]);
}

export interface CartaoArquivado extends Cartao {
  colunaNomeOriginal: string;
}

export async function listarArquivados(usuarioId: number): Promise<CartaoArquivado[]> {
  const { rows } = await pool.query(
    `SELECT tc.id, tc.coluna_id, tc.titulo, tc.concluido, tc.ordem, col.nome AS coluna_nome
     FROM tarefas_cartoes tc
     JOIN tarefas_colunas col ON col.id = tc.coluna_id
     WHERE tc.arquivado = true AND col.usuario_id = $1
     ORDER BY tc.atualizado_em DESC`,
    [usuarioId]
  );
  return rows.map((r) => ({ ...linhaParaCartao(r), colunaNomeOriginal: r.coluna_nome }));
}

export async function restaurarCartao(id: number, usuarioId: number, colunaId: number): Promise<void> {
  await garantirCartaoDoUsuario(id, usuarioId);
  await garantirColunaDoUsuario(colunaId, usuarioId);
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
