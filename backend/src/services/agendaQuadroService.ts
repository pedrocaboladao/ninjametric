import { pool } from "../db/pool";

export interface CardQuadro {
  id: number;
  titulo: string;
  descricao: string | null;
  atribuidoAUsuarioId: number | null;
  atribuidoANome: string | null;
  lojaId: number | null;
  lojaNome: string | null;
}

export interface ColunaQuadro {
  id: number;
  nome: string;
  cards: CardQuadro[];
}

const COLUNAS_PADRAO = ["A fazer", "Em andamento", "Feito"];

async function garantirColunasPadrao(): Promise<void> {
  const { rows } = await pool.query<{ total: number }>("SELECT COUNT(*)::int AS total FROM agenda_quadro_colunas");
  if (rows[0].total > 0) return;
  for (const [indice, nome] of COLUNAS_PADRAO.entries()) {
    await pool.query("INSERT INTO agenda_quadro_colunas (nome, ordem) VALUES ($1, $2)", [nome, indice]);
  }
}

export async function listarQuadro(): Promise<ColunaQuadro[]> {
  await garantirColunasPadrao();
  const { rows: colunas } = await pool.query<{ id: number; nome: string }>(
    "SELECT id, nome FROM agenda_quadro_colunas ORDER BY ordem, id"
  );
  const { rows: cards } = await pool.query<{
    id: number;
    coluna_id: number;
    titulo: string;
    descricao: string | null;
    atribuido_a_usuario_id: number | null;
    atribuido_a_nome: string | null;
    loja_id: number | null;
    loja_nome: string | null;
  }>(
    `SELECT c.id, c.coluna_id, c.titulo, c.descricao, c.atribuido_a_usuario_id, u.nome AS atribuido_a_nome,
            c.loja_id, loja.nome AS loja_nome
     FROM agenda_quadro_cards c
     LEFT JOIN usuarios u ON u.id = c.atribuido_a_usuario_id
     LEFT JOIN lojas loja ON loja.id = c.loja_id
     ORDER BY c.ordem, c.id`
  );
  return colunas.map((col) => ({
    id: col.id,
    nome: col.nome,
    cards: cards
      .filter((c) => c.coluna_id === col.id)
      .map((c) => ({
        id: c.id,
        titulo: c.titulo,
        descricao: c.descricao,
        atribuidoAUsuarioId: c.atribuido_a_usuario_id,
        atribuidoANome: c.atribuido_a_nome,
        lojaId: c.loja_id,
        lojaNome: c.loja_nome,
      })),
  }));
}

export async function criarColuna(nome: string): Promise<void> {
  await pool.query(
    "INSERT INTO agenda_quadro_colunas (nome, ordem) VALUES ($1, (SELECT COALESCE(MAX(ordem), -1) + 1 FROM agenda_quadro_colunas))",
    [nome]
  );
}

export async function renomearColuna(id: number, nome: string): Promise<void> {
  await pool.query("UPDATE agenda_quadro_colunas SET nome = $1 WHERE id = $2", [nome, id]);
}

export async function excluirColuna(id: number): Promise<void> {
  const { rows } = await pool.query<{ total: number }>(
    "SELECT COUNT(*)::int AS total FROM agenda_quadro_cards WHERE coluna_id = $1",
    [id]
  );
  if (rows[0].total > 0) {
    throw new Error("Essa coluna ainda tem cards. Mova ou exclua os cards antes de remover a coluna.");
  }
  await pool.query("DELETE FROM agenda_quadro_colunas WHERE id = $1", [id]);
}

export async function criarCard(
  criadoPorUsuarioId: number,
  colunaId: number,
  dados: { titulo: string; descricao?: string | null; atribuidoAUsuarioId?: number | null; lojaId?: number | null }
): Promise<void> {
  await pool.query(
    `INSERT INTO agenda_quadro_cards (coluna_id, titulo, descricao, atribuido_a_usuario_id, loja_id, criado_por_usuario_id, ordem)
     VALUES ($1, $2, $3, $4, $5, $6,
       (SELECT COALESCE(MAX(ordem), -1) + 1 FROM agenda_quadro_cards WHERE coluna_id = $1))`,
    [
      colunaId,
      dados.titulo,
      dados.descricao ?? null,
      dados.atribuidoAUsuarioId ?? null,
      dados.lojaId ?? null,
      criadoPorUsuarioId,
    ]
  );
}

export async function atualizarCard(
  id: number,
  dados: Partial<{ titulo: string; descricao: string | null; atribuidoAUsuarioId: number | null; lojaId: number | null }>
): Promise<void> {
  const campos: string[] = [];
  const valores: unknown[] = [];
  function set(coluna: string, valor: unknown) {
    valores.push(valor);
    campos.push(`${coluna} = $${valores.length}`);
  }
  if (dados.titulo !== undefined) set("titulo", dados.titulo);
  if (dados.descricao !== undefined) set("descricao", dados.descricao);
  if (dados.atribuidoAUsuarioId !== undefined) set("atribuido_a_usuario_id", dados.atribuidoAUsuarioId);
  if (dados.lojaId !== undefined) set("loja_id", dados.lojaId);
  if (campos.length === 0) return;
  campos.push("atualizado_em = now()");
  valores.push(id);
  await pool.query(`UPDATE agenda_quadro_cards SET ${campos.join(", ")} WHERE id = $${valores.length}`, valores);
}

export async function moverCard(id: number, colunaId: number): Promise<void> {
  await pool.query(
    `UPDATE agenda_quadro_cards
     SET coluna_id = $1,
         ordem = (SELECT COALESCE(MAX(ordem), -1) + 1 FROM agenda_quadro_cards WHERE coluna_id = $1),
         atualizado_em = now()
     WHERE id = $2`,
    [colunaId, id]
  );
}

export async function excluirCard(id: number): Promise<void> {
  await pool.query("DELETE FROM agenda_quadro_cards WHERE id = $1", [id]);
}
