import { pool } from "../db/pool";

export interface AnexoCard {
  id: number;
  nome: string;
  tipo: string;
  tamanho: number;
  capa: boolean;
  criadoEm: string;
}

export interface CardQuadro {
  id: number;
  titulo: string;
  descricao: string | null;
  atribuidoAUsuarioId: number | null;
  atribuidoANome: string | null;
  lojaId: number | null;
  lojaNome: string | null;
  capaAnexoId: number | null;
  totalAnexos: number;
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
    capa_anexo_id: number | null;
    total_anexos: number;
  }>(
    `SELECT c.id, c.coluna_id, c.titulo, c.descricao, c.atribuido_a_usuario_id, u.nome AS atribuido_a_nome,
            c.loja_id, loja.nome AS loja_nome,
            (SELECT a.id FROM agenda_quadro_anexos a WHERE a.card_id = c.id AND a.capa LIMIT 1) AS capa_anexo_id,
            (SELECT COUNT(*)::int FROM agenda_quadro_anexos a WHERE a.card_id = c.id) AS total_anexos
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
        capaAnexoId: c.capa_anexo_id,
        totalAnexos: c.total_anexos,
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

export async function listarAnexosDoCard(cardId: number): Promise<AnexoCard[]> {
  const { rows } = await pool.query<{ id: number; nome: string; tipo: string; tamanho: number; capa: boolean; criado_em: string }>(
    "SELECT id, nome, tipo, tamanho, capa, criado_em FROM agenda_quadro_anexos WHERE card_id = $1 ORDER BY criado_em",
    [cardId]
  );
  return rows.map((r) => ({ id: r.id, nome: r.nome, tipo: r.tipo, tamanho: r.tamanho, capa: r.capa, criadoEm: r.criado_em }));
}

export async function salvarAnexoDoCard(cardId: number, nome: string, tipo: string, conteudo: Buffer): Promise<void> {
  await pool.query(
    "INSERT INTO agenda_quadro_anexos (card_id, nome, tipo, tamanho, conteudo) VALUES ($1, $2, $3, $4, $5)",
    [cardId, nome, tipo, conteudo.length, conteudo]
  );
}

export async function lerAnexoDoCard(anexoId: number): Promise<{ nome: string; tipo: string; conteudo: Buffer } | null> {
  const { rows } = await pool.query<{ nome: string; tipo: string; conteudo: Buffer }>(
    "SELECT nome, tipo, conteudo FROM agenda_quadro_anexos WHERE id = $1",
    [anexoId]
  );
  return rows[0] ?? null;
}

export async function apagarAnexoDoCard(anexoId: number): Promise<void> {
  await pool.query("DELETE FROM agenda_quadro_anexos WHERE id = $1", [anexoId]);
}

// Capa é sempre uma imagem e só uma por card: ao marcar uma, desmarca as outras.
export async function definirCapaDoCard(anexoId: number, marcar: boolean): Promise<void> {
  if (!marcar) {
    await pool.query("UPDATE agenda_quadro_anexos SET capa = false WHERE id = $1", [anexoId]);
    return;
  }
  const { rows } = await pool.query<{ card_id: number; tipo: string }>(
    "SELECT card_id, tipo FROM agenda_quadro_anexos WHERE id = $1",
    [anexoId]
  );
  if (!rows[0]) throw new Error("Anexo não encontrado.");
  if (!rows[0].tipo.startsWith("image/")) throw new Error("A capa precisa ser uma imagem.");
  await pool.query("UPDATE agenda_quadro_anexos SET capa = false WHERE card_id = $1", [rows[0].card_id]);
  await pool.query("UPDATE agenda_quadro_anexos SET capa = true WHERE id = $1", [anexoId]);
}

// Cria uma cópia do card na coluna de destino (no fim), com os mesmos dados e
// arquivos. O card original fica onde está.
export async function clonarCard(cardId: number, colunaId: number, usuarioId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO agenda_quadro_cards (coluna_id, titulo, descricao, atribuido_a_usuario_id, loja_id, criado_por_usuario_id, ordem)
       SELECT $2, titulo, descricao, atribuido_a_usuario_id, loja_id, $3,
         (SELECT COALESCE(MAX(ordem), -1) + 1 FROM agenda_quadro_cards WHERE coluna_id = $2)
       FROM agenda_quadro_cards WHERE id = $1
       RETURNING id`,
      [cardId, colunaId, usuarioId]
    );
    if (rows.length === 0) throw new Error("Card não encontrado.");
    await client.query(
      `INSERT INTO agenda_quadro_anexos (card_id, nome, tipo, tamanho, conteudo, capa)
       SELECT $2, nome, tipo, tamanho, conteudo, capa FROM agenda_quadro_anexos WHERE card_id = $1`,
      [cardId, rows[0].id]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
