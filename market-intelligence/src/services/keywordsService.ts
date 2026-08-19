import { pool } from "../db/pool";

export interface Keyword {
  id: number;
  keyword: string;
  active: boolean;
  createdAt: string;
  lastCollectedAt: string | null;
}

function mapRow(r: any): Keyword {
  return {
    id: r.id,
    keyword: r.keyword,
    active: r.active,
    createdAt: r.created_at,
    lastCollectedAt: r.last_collected_at,
  };
}

export async function listarKeywords(): Promise<Keyword[]> {
  const { rows } = await pool.query("SELECT * FROM keywords ORDER BY keyword ASC");
  return rows.map(mapRow);
}

export async function obterKeyword(id: number): Promise<Keyword | null> {
  const { rows } = await pool.query("SELECT * FROM keywords WHERE id = $1", [id]);
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function criarKeyword(keyword: string): Promise<Keyword> {
  const { rows } = await pool.query(
    `INSERT INTO keywords (keyword) VALUES ($1)
     ON CONFLICT (keyword) DO UPDATE SET keyword = EXCLUDED.keyword
     RETURNING *`,
    [keyword.trim()]
  );
  return mapRow(rows[0]);
}

export async function definirAtiva(id: number, active: boolean): Promise<void> {
  await pool.query("UPDATE keywords SET active = $1 WHERE id = $2", [active, id]);
}

export async function marcarColetada(id: number): Promise<void> {
  await pool.query("UPDATE keywords SET last_collected_at = now() WHERE id = $1", [id]);
}
