import { pool } from "../db/pool";
import { listarVendasFinanceiras } from "./financeiroService";

// Recalcula e re-grava o snapshot de vendas no prejuízo (últimas 7 dias, ver
// listarVendasFinanceiras) — reaproveita 100% o cálculo já pronto do
// Financeiro (custo/taxa/frete reais, não estimados), só filtra o que já é
// prejuízo confirmado e guarda pra leitura rápida no Dashboard (sem chamada
// à API do ML a cada carregamento). Roda pra TODAS as lojas de uma vez
// (lojaIdFiltro/lojasPermitidas indefinidos), e o filtro por loja acontece
// só na hora de listar.
export async function capturarVendasNegativas(): Promise<void> {
  const { vendas } = await listarVendasFinanceiras(undefined, undefined, undefined, undefined, true);
  const negativas = vendas.filter((v) => v.margemContribuicao !== null && v.margemContribuicao < 0);

  for (const v of negativas) {
    await pool.query(
      `INSERT INTO vendas_negativas_snapshot
         (order_id, item_id, loja_id, data_criacao, titulo, sku, quantidade, receita_total, custo_total,
          taxa_ml_total, frete_vendedor_total, imposto_total, margem_contribuicao, margem_percentual, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
       ON CONFLICT (order_id, item_id) DO UPDATE SET
         loja_id = EXCLUDED.loja_id, data_criacao = EXCLUDED.data_criacao, titulo = EXCLUDED.titulo,
         sku = EXCLUDED.sku, quantidade = EXCLUDED.quantidade, receita_total = EXCLUDED.receita_total,
         custo_total = EXCLUDED.custo_total, taxa_ml_total = EXCLUDED.taxa_ml_total,
         frete_vendedor_total = EXCLUDED.frete_vendedor_total, imposto_total = EXCLUDED.imposto_total,
         margem_contribuicao = EXCLUDED.margem_contribuicao, margem_percentual = EXCLUDED.margem_percentual,
         atualizado_em = now()`,
      [
        v.orderId,
        v.itemId,
        v.lojaId,
        v.dataCriacao,
        v.titulo,
        v.sku,
        v.quantidade,
        v.receitaTotal,
        v.custoTotal,
        v.taxaMlTotal,
        v.freteVendedorTotal,
        v.impostoTotal,
        v.margemContribuicao,
        v.margemPercentual,
      ]
    );
  }

  // Venda que saiu da janela de 7 dias ou teve o custo corrigido pra uma
  // margem não-negativa não deve continuar presa no snapshot — remove tudo
  // que não está na lista recém-calculada (mesma ideia do estoque_snapshot,
  // só que com chave composta order_id+item_id em vez de item_id só).
  if (negativas.length > 0) {
    await pool.query(
      `DELETE FROM vendas_negativas_snapshot v
       WHERE NOT EXISTS (
         SELECT 1 FROM unnest($1::bigint[], $2::text[]) AS atual(order_id, item_id)
         WHERE atual.order_id = v.order_id AND atual.item_id = v.item_id
       )`,
      [negativas.map((v) => v.orderId), negativas.map((v) => v.itemId)]
    );
  } else {
    await pool.query("DELETE FROM vendas_negativas_snapshot");
  }
}

const INTERVALO_MS = 4 * 60 * 60 * 1000; // 4h, mesmo ritmo do snapshot de estoque

export function iniciarSnapshotVendasNegativas(): void {
  capturarVendasNegativas()
    .then(() => console.log("Snapshot de vendas negativas concluído."))
    .catch((err) => console.error("Erro no snapshot inicial de vendas negativas:", err));
  setInterval(() => {
    capturarVendasNegativas()
      .then(() => console.log("Snapshot de vendas negativas concluído."))
      .catch((err) => console.error("Erro no snapshot periódico de vendas negativas:", err));
  }, INTERVALO_MS);
}

export interface VendaNegativa {
  orderId: number;
  itemId: string;
  lojaId: number;
  lojaNome: string;
  dataCriacao: string;
  titulo: string;
  sku: string | null;
  quantidade: number;
  receitaTotal: number;
  custoTotal: number | null;
  taxaMlTotal: number;
  freteVendedorTotal: number | null;
  impostoTotal: number;
  margemContribuicao: number;
  margemPercentual: number | null;
}

export async function listarVendasNegativas(lojaId?: number, lojasPermitidas?: number[]): Promise<VendaNegativa[]> {
  const condicoes: string[] = [];
  const params: (number | number[])[] = [];

  if (lojaId !== undefined) {
    params.push(lojaId);
    condicoes.push(`v.loja_id = $${params.length}`);
  } else if (lojasPermitidas !== undefined) {
    params.push(lojasPermitidas);
    condicoes.push(`v.loja_id = ANY($${params.length}::int[])`);
  }

  const { rows } = await pool.query<{
    order_id: string;
    item_id: string;
    loja_id: number;
    loja_nome: string;
    data_criacao: string;
    titulo: string;
    sku: string | null;
    quantidade: number;
    receita_total: string;
    custo_total: string | null;
    taxa_ml_total: string;
    frete_vendedor_total: string | null;
    imposto_total: string;
    margem_contribuicao: string;
    margem_percentual: string | null;
  }>(
    `SELECT v.order_id, v.item_id, v.loja_id, l.nome AS loja_nome, v.data_criacao, v.titulo, v.sku, v.quantidade,
            v.receita_total, v.custo_total, v.taxa_ml_total, v.frete_vendedor_total, v.imposto_total,
            v.margem_contribuicao, v.margem_percentual
     FROM vendas_negativas_snapshot v
     JOIN lojas l ON l.id = v.loja_id
     ${condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : ""}
     ORDER BY v.margem_contribuicao ASC
     LIMIT 500`,
    params
  );

  return rows.map((r) => ({
    orderId: Number(r.order_id),
    itemId: r.item_id,
    lojaId: r.loja_id,
    lojaNome: r.loja_nome,
    dataCriacao: r.data_criacao,
    titulo: r.titulo,
    sku: r.sku,
    quantidade: r.quantidade,
    receitaTotal: Number(r.receita_total),
    custoTotal: r.custo_total !== null ? Number(r.custo_total) : null,
    taxaMlTotal: Number(r.taxa_ml_total),
    freteVendedorTotal: r.frete_vendedor_total !== null ? Number(r.frete_vendedor_total) : null,
    impostoTotal: Number(r.imposto_total),
    margemContribuicao: Number(r.margem_contribuicao),
    margemPercentual: r.margem_percentual !== null ? Number(r.margem_percentual) : null,
  }));
}
