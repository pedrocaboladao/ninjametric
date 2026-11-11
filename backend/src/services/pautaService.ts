import { pool } from "../db/pool";

export type StatusPauta = "sugerido" | "selecionado" | "discutido" | "adiado";

export interface PautaItem {
  id: number;
  titulo: string;
  descricao: string | null;
  lojaId: number | null;
  lojaNome: string | null;
  area: string | null;
  status: StatusPauta;
  reuniaoData: string | null;
  decisao: string | null;
  criadoPorId: number;
  criadoPorNome: string;
  criadoEm: string;
  atualizadoEm: string;
  apoios: number;
  apoiadoPorMim: boolean;
}

function dataParaISO(valor: unknown): string | null {
  if (!valor) return null;
  return valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor).slice(0, 10);
}

function linhaParaItem(r: Record<string, unknown>, usuarioId: number): PautaItem {
  return {
    id: r.id as number,
    titulo: r.titulo as string,
    descricao: (r.descricao as string | null) ?? null,
    lojaId: (r.loja_id as number | null) ?? null,
    lojaNome: (r.loja_nome as string | null) ?? null,
    area: (r.area as string | null) ?? null,
    status: r.status as StatusPauta,
    reuniaoData: dataParaISO(r.reuniao_data),
    decisao: (r.decisao as string | null) ?? null,
    criadoPorId: r.criado_por as number,
    criadoPorNome: r.criado_por_nome as string,
    criadoEm: r.criado_em as string,
    atualizadoEm: r.atualizado_em as string,
    apoios: Number(r.apoios ?? 0),
    apoiadoPorMim: Boolean(r.apoiado_por_mim),
  };
}

const SELECT_BASE = `
  SELECT p.*, l.nome AS loja_nome, u.nome AS criado_por_nome,
    (SELECT COUNT(*) FROM pauta_apoios pa WHERE pa.item_id = p.id) AS apoios,
    EXISTS(SELECT 1 FROM pauta_apoios pa WHERE pa.item_id = p.id AND pa.usuario_id = $1) AS apoiado_por_mim
  FROM pauta_itens p
  LEFT JOIN lojas l ON l.id = p.loja_id
  JOIN usuarios u ON u.id = p.criado_por
`;

export async function listarItens(usuarioId: number): Promise<PautaItem[]> {
  const { rows } = await pool.query(`${SELECT_BASE} ORDER BY p.criado_em DESC`, [usuarioId]);
  return rows.map((r) => linhaParaItem(r, usuarioId));
}

export async function criarItem(
  usuarioId: number,
  titulo: string,
  descricao: string | null,
  lojaId: number | null,
  area: string | null
): Promise<PautaItem> {
  const { rows } = await pool.query(
    `INSERT INTO pauta_itens (titulo, descricao, loja_id, area, criado_por)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [titulo, descricao, lojaId, area, usuarioId]
  );
  return obterItem(rows[0].id, usuarioId);
}

async function obterItem(id: number, usuarioId: number): Promise<PautaItem> {
  const { rows } = await pool.query(`${SELECT_BASE} WHERE p.id = $2`, [usuarioId, id]);
  if (rows.length === 0) throw new Error("Item de pauta não encontrado.");
  return linhaParaItem(rows[0], usuarioId);
}

export async function apoiar(usuarioId: number, itemId: number): Promise<void> {
  await pool.query(
    `INSERT INTO pauta_apoios (item_id, usuario_id) VALUES ($1, $2) ON CONFLICT (item_id, usuario_id) DO NOTHING`,
    [itemId, usuarioId]
  );
}

export async function desapoiar(usuarioId: number, itemId: number): Promise<void> {
  await pool.query(`DELETE FROM pauta_apoios WHERE item_id = $1 AND usuario_id = $2`, [itemId, usuarioId]);
}

// Usado tanto pra selecionar um item "sugerido" quanto pra reagendar um
// "adiado" numa nova data — mesma transição, só muda o status de origem.
export async function selecionarParaReuniao(itemId: number, reuniaoData: string): Promise<void> {
  await pool.query(
    `UPDATE pauta_itens SET status = 'selecionado', reuniao_data = $2, atualizado_em = now() WHERE id = $1`,
    [itemId, reuniaoData]
  );
}

export async function marcarDiscutido(itemId: number, decisao: string | null): Promise<void> {
  await pool.query(
    `UPDATE pauta_itens SET status = 'discutido', decisao = $2, atualizado_em = now() WHERE id = $1`,
    [itemId, decisao]
  );
}

export async function adiarItem(itemId: number): Promise<void> {
  await pool.query(`UPDATE pauta_itens SET status = 'adiado', atualizado_em = now() WHERE id = $1`, [itemId]);
}

export async function obterDonoEStatus(itemId: number): Promise<{ criadoPor: number; status: StatusPauta } | null> {
  const { rows } = await pool.query(`SELECT criado_por, status FROM pauta_itens WHERE id = $1`, [itemId]);
  if (rows.length === 0) return null;
  return { criadoPor: rows[0].criado_por, status: rows[0].status };
}

export async function excluirItem(itemId: number): Promise<void> {
  await pool.query(`DELETE FROM pauta_itens WHERE id = $1`, [itemId]);
}
