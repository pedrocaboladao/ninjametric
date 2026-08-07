import { pool } from "../db/pool";
import { listLojas } from "./tokenStore";
import { listarItensAtivos, getItemsBasicInfo } from "./mercadoLivreApi";

// Snapshot de estoque de uma loja só — escaneia todo item ativo (até 1000,
// limitação da própria API do ML) e guarda o estoque de cada um. Itens que
// não estão mais ativos (vendidos, pausados, excluídos) são removidos do
// snapshot dessa loja, senão ficariam "presos" mostrando estoque baixo pra
// sempre mesmo depois de o anúncio sumir.
export async function capturarEstoqueDaLoja(lojaId: number, mlUserId: number): Promise<void> {
  const itemIds = await listarItensAtivos(lojaId, mlUserId);
  const itens = await getItemsBasicInfo(lojaId, itemIds);

  for (const item of itens.values()) {
    if (item.available_quantity === undefined) continue;
    await pool.query(
      `INSERT INTO estoque_snapshot (loja_id, item_id, titulo, estoque, thumbnail, permalink, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (loja_id, item_id)
       DO UPDATE SET titulo = EXCLUDED.titulo, estoque = EXCLUDED.estoque, thumbnail = EXCLUDED.thumbnail,
                      permalink = EXCLUDED.permalink, atualizado_em = now()`,
      [lojaId, item.id, item.title, item.available_quantity, item.thumbnail, item.permalink]
    );
  }

  await pool.query("DELETE FROM estoque_snapshot WHERE loja_id = $1 AND item_id != ALL($2::text[])", [
    lojaId,
    itemIds,
  ]);
}

export async function capturarEstoqueDeTodasLojas(): Promise<void> {
  const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null);
  for (const loja of lojas) {
    try {
      await capturarEstoqueDaLoja(loja.id, loja.ml_user_id as number);
    } catch (err) {
      console.error(`Falha ao capturar estoque da loja ${loja.id}:`, err);
    }
  }
}

const INTERVALO_MS = 4 * 60 * 60 * 1000; // 4h, mesmo ritmo dos outros snapshots (ver adsService)

export function iniciarSnapshotEstoque(): void {
  capturarEstoqueDeTodasLojas()
    .then(() => console.log("Snapshot de estoque concluído."))
    .catch((err) => console.error("Erro no snapshot inicial de estoque:", err));
  setInterval(() => {
    capturarEstoqueDeTodasLojas()
      .then(() => console.log("Snapshot de estoque concluído."))
      .catch((err) => console.error("Erro no snapshot periódico de estoque:", err));
  }, INTERVALO_MS);
}

export interface ProdutoEstoqueBaixo {
  lojaId: number;
  lojaNome: string;
  itemId: string;
  titulo: string;
  estoque: number;
  thumbnail: string | null;
  permalink: string | null;
  atualizadoEm: string;
}

export async function listarEstoqueBaixo(
  limite: number,
  lojaId?: number,
  lojasPermitidas?: number[]
): Promise<ProdutoEstoqueBaixo[]> {
  const condicoes = ["e.estoque <= $1"];
  const params: (number | number[])[] = [limite];

  if (lojaId !== undefined) {
    params.push(lojaId);
    condicoes.push(`e.loja_id = $${params.length}`);
  } else if (lojasPermitidas !== undefined) {
    params.push(lojasPermitidas);
    condicoes.push(`e.loja_id = ANY($${params.length}::int[])`);
  }

  const { rows } = await pool.query<{
    loja_id: number;
    loja_nome: string;
    item_id: string;
    titulo: string;
    estoque: number;
    thumbnail: string | null;
    permalink: string | null;
    atualizado_em: string;
  }>(
    `SELECT e.loja_id, l.nome AS loja_nome, e.item_id, e.titulo, e.estoque, e.thumbnail, e.permalink, e.atualizado_em
     FROM estoque_snapshot e
     JOIN lojas l ON l.id = e.loja_id
     WHERE ${condicoes.join(" AND ")}
     ORDER BY e.estoque ASC
     LIMIT 500`,
    params
  );

  return rows.map((r) => ({
    lojaId: r.loja_id,
    lojaNome: r.loja_nome,
    itemId: r.item_id,
    titulo: r.titulo,
    estoque: r.estoque,
    thumbnail: r.thumbnail,
    permalink: r.permalink,
    atualizadoEm: r.atualizado_em,
  }));
}
