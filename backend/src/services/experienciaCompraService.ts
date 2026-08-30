import { pool } from "../db/pool";
import { listLojas, type Loja } from "./tokenStore";
import { buscarCandidatosSaudeReputacao, getPurchaseExperienceDoItem, getItemsBasicInfo } from "./mercadoLivreApi";

async function comConcorrenciaLimitada<T, R>(itens: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(itens.length);
  let indice = 0;
  async function worker() {
    while (indice < itens.length) {
      const i = indice++;
      resultados[i] = await fn(itens[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, worker));
  return resultados;
}

interface ExperienciaCompraRuimInterna {
  itemId: string;
  titulo: string;
  thumbnail: string | null;
  permalink: string | null;
  sku: string | null;
  reputationColor: string;
  reputationValue: number;
  reputationText: string | null;
  motivoTexto: string | null;
  recomendacaoTexto: string | null;
}

// Junta os candidatos de "unhealthy" e "warning" (com dedup — o Mercado
// Livre pode devolver o mesmo item nos dois), checa o detalhe real
// de cada um e mantém só quem tem Experiência de Compra de verdade ruim:
// color !== "green" (exclui "Boa") e value >= 0 (exclui "ainda sem dados").
// Esse filtro em cima do detalhe é o que importa — o gauge em massa é só
// um jeito de reduzir quantos itens precisam da chamada cara de detalhe.
async function coletarExperienciaCompraDaLoja(loja: Loja): Promise<ExperienciaCompraRuimInterna[]> {
  const mlUserId = loja.ml_user_id as number;
  const [unhealthy, warning] = await Promise.all([
    buscarCandidatosSaudeReputacao(loja.id, mlUserId, "unhealthy"),
    buscarCandidatosSaudeReputacao(loja.id, mlUserId, "warning"),
  ]);
  const candidatos = Array.from(new Set([...unhealthy, ...warning]));

  const detalhes = await comConcorrenciaLimitada(candidatos, 8, async (itemId) => ({
    itemId,
    detalhe: await getPurchaseExperienceDoItem(loja.id, itemId),
  }));

  const ruins = detalhes.filter(
    (d): d is { itemId: string; detalhe: NonNullable<(typeof d)["detalhe"]> } =>
      d.detalhe !== null && d.detalhe.color !== "green" && d.detalhe.value >= 0
  );
  if (ruins.length === 0) return [];

  const info = await getItemsBasicInfo(
    loja.id,
    ruins.map((r) => r.itemId)
  );

  return ruins.map((r) => {
    const item = info.get(r.itemId);
    return {
      itemId: r.itemId,
      titulo: item?.title ?? r.itemId,
      thumbnail: item?.thumbnail ?? null,
      permalink: item?.permalink ?? null,
      sku: item?.seller_custom_field ?? null,
      reputationColor: r.detalhe.color,
      reputationValue: r.detalhe.value,
      reputationText: r.detalhe.text,
      motivoTexto: r.detalhe.motivoTexto,
      recomendacaoTexto: r.detalhe.recomendacaoTexto,
    };
  });
}

async function gravarSnapshot(lojaId: number, itens: ExperienciaCompraRuimInterna[]): Promise<void> {
  await pool.query("DELETE FROM experiencia_compra_snapshot WHERE loja_id = $1", [lojaId]);
  for (const i of itens) {
    await pool.query(
      `INSERT INTO experiencia_compra_snapshot
         (loja_id, item_id, titulo, thumbnail, permalink, sku, reputation_color, reputation_value,
          reputation_text, motivo_texto, recomendacao_texto, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       ON CONFLICT (loja_id, item_id) DO UPDATE SET
         titulo = EXCLUDED.titulo, thumbnail = EXCLUDED.thumbnail, permalink = EXCLUDED.permalink,
         sku = EXCLUDED.sku, reputation_color = EXCLUDED.reputation_color,
         reputation_value = EXCLUDED.reputation_value, reputation_text = EXCLUDED.reputation_text,
         motivo_texto = EXCLUDED.motivo_texto, recomendacao_texto = EXCLUDED.recomendacao_texto,
         atualizado_em = now()`,
      [
        lojaId,
        i.itemId,
        i.titulo,
        i.thumbnail,
        i.permalink,
        i.sku,
        i.reputationColor,
        i.reputationValue,
        i.reputationText,
        i.motivoTexto,
        i.recomendacaoTexto,
      ]
    );
  }
}

export async function capturarExperienciaCompra(): Promise<void> {
  const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null);

  for (const loja of lojas) {
    try {
      const itens = await coletarExperienciaCompraDaLoja(loja);
      await gravarSnapshot(loja.id, itens);
    } catch (err) {
      console.error(`Experiência de Compra: falha ao checar a loja ${loja.id}, pulando essa loja:`, err);
    }
  }
}

const INTERVALO_MS = 4 * 60 * 60 * 1000; // 4h, mesmo ritmo do estoque/vendas negativas/anúncios negativos/catálogo

export function iniciarSnapshotExperienciaCompra(): void {
  capturarExperienciaCompra()
    .then(() => console.log("Snapshot de Experiência de Compra concluído."))
    .catch((err) => console.error("Erro no snapshot inicial de Experiência de Compra:", err));
  setInterval(() => {
    capturarExperienciaCompra()
      .then(() => console.log("Snapshot de Experiência de Compra concluído."))
      .catch((err) => console.error("Erro no snapshot periódico de Experiência de Compra:", err));
  }, INTERVALO_MS);
}

export interface ExperienciaCompraRuim {
  lojaId: number;
  lojaNome: string;
  itemId: string;
  titulo: string;
  thumbnail: string | null;
  permalink: string | null;
  sku: string | null;
  reputationColor: string;
  reputationValue: number;
  reputationText: string | null;
  motivoTexto: string | null;
  recomendacaoTexto: string | null;
  atualizadoEm: string;
}

export async function listarExperienciaCompraRuim(lojaId?: number, lojasPermitidas?: number[]): Promise<ExperienciaCompraRuim[]> {
  const condicoes: string[] = [];
  const params: (number | number[])[] = [];

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
    thumbnail: string | null;
    permalink: string | null;
    sku: string | null;
    reputation_color: string;
    reputation_value: string;
    reputation_text: string | null;
    motivo_texto: string | null;
    recomendacao_texto: string | null;
    atualizado_em: string;
  }>(
    `SELECT e.loja_id, l.nome AS loja_nome, e.item_id, e.titulo, e.thumbnail, e.permalink, e.sku,
            e.reputation_color, e.reputation_value, e.reputation_text, e.motivo_texto, e.recomendacao_texto,
            e.atualizado_em
     FROM experiencia_compra_snapshot e
     JOIN lojas l ON l.id = e.loja_id
     ${condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : ""}
     ORDER BY e.reputation_value ASC
     LIMIT 500`,
    params
  );

  return rows.map((r) => ({
    lojaId: r.loja_id,
    lojaNome: r.loja_nome,
    itemId: r.item_id,
    titulo: r.titulo,
    thumbnail: r.thumbnail,
    permalink: r.permalink,
    sku: r.sku,
    reputationColor: r.reputation_color,
    reputationValue: Number(r.reputation_value),
    reputationText: r.reputation_text,
    motivoTexto: r.motivo_texto,
    recomendacaoTexto: r.recomendacao_texto,
    atualizadoEm: r.atualizado_em,
  }));
}
