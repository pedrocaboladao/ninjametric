import { pool } from "../db/pool";
import { listLojas, type Loja } from "./tokenStore";
import { listarItensAtivos, getItemsBasicInfo, getPriceToWin, getTaxaMlParaPreco } from "./mercadoLivreApi";
import { listarProdutos } from "./produtosService";
import { normalizarSku } from "./financeiroService";

// Só as 4 contas PESSOAIS do usuário — mesmo escopo do Analista de Ads e do
// Agente de Oportunidades (ver LOJAS_AGENTE em agenteAdsService.ts).
const LOJAS_AGENTE = [1, 2, 3, 4];

const formatCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format;

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

// Margem = preço - custo cadastrado - taxa real do ML naquele preço
// (categoria + tipo de anúncio) - imposto da loja. Null se faltar custo
// cadastrado ou não der pra calcular a taxa do ML (categoria/tipo ausente).
export function calcularMargem(
  preco: number,
  custoUnitario: number | null,
  taxaMl: number | null,
  impostoPercentual: number
): number | null {
  if (custoUnitario === null || taxaMl === null) return null;
  const imposto = preco * (impostoPercentual / 100);
  return preco - custoUnitario - taxaMl - imposto;
}

interface ItemCatalogoInterno {
  itemId: string;
  titulo: string;
  thumbnail: string | null;
  permalink: string | null;
  status: string;
  precoAtual: number;
  priceToWin: number | null;
  sku: string | null;
  custoUnitario: number | null;
  margemAtual: number | null;
  margemNoPriceToWin: number | null;
}

async function coletarCatalogoDaLoja(loja: Loja, custoPorSku: Map<string, number>): Promise<ItemCatalogoInterno[]> {
  const itemIds = await listarItensAtivos(loja.id, loja.ml_user_id as number);
  const itens = await getItemsBasicInfo(loja.id, itemIds);
  const itensCatalogo = Array.from(itens.values()).filter((i) => i.catalog_listing === true);

  const linhas = await comConcorrenciaLimitada(itensCatalogo, 10, async (item) => {
    const detalhe = await getPriceToWin(loja.id, item.id);
    if (!detalhe || detalhe.status === "winning" || detalhe.priceToWin === null) return null;

    const skuNorm = item.seller_custom_field ? normalizarSku(item.seller_custom_field) : null;
    const custoUnitario = skuNorm !== null ? (custoPorSku.get(skuNorm) ?? null) : null;

    let taxaMlAtual: number | null = null;
    let taxaMlNoPriceToWin: number | null = null;
    if (item.category_id && item.listing_type_id) {
      [taxaMlAtual, taxaMlNoPriceToWin] = await Promise.all([
        getTaxaMlParaPreco(loja.id, item.category_id, item.listing_type_id, detalhe.currentPrice),
        getTaxaMlParaPreco(loja.id, item.category_id, item.listing_type_id, detalhe.priceToWin),
      ]);
    }

    return {
      itemId: item.id,
      titulo: item.title,
      thumbnail: item.thumbnail ?? null,
      permalink: item.permalink ?? null,
      status: detalhe.status,
      precoAtual: detalhe.currentPrice,
      priceToWin: detalhe.priceToWin,
      sku: item.seller_custom_field ?? null,
      custoUnitario,
      margemAtual: calcularMargem(detalhe.currentPrice, custoUnitario, taxaMlAtual, loja.imposto_percentual),
      margemNoPriceToWin: calcularMargem(detalhe.priceToWin, custoUnitario, taxaMlNoPriceToWin, loja.imposto_percentual),
    };
  });

  return linhas.filter((l): l is NonNullable<typeof l> => l !== null);
}

async function gravarSnapshot(lojaId: number, itens: ItemCatalogoInterno[]): Promise<void> {
  for (const l of itens) {
    await pool.query(
      `INSERT INTO agente_catalogo_snapshot
         (loja_id, item_id, titulo, thumbnail, permalink, status, preco_atual, price_to_win, sku,
          custo_unitario, margem_atual, margem_no_price_to_win, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
       ON CONFLICT (loja_id, item_id) DO UPDATE SET
         titulo = EXCLUDED.titulo, thumbnail = EXCLUDED.thumbnail, permalink = EXCLUDED.permalink,
         status = EXCLUDED.status, preco_atual = EXCLUDED.preco_atual, price_to_win = EXCLUDED.price_to_win,
         sku = EXCLUDED.sku, custo_unitario = EXCLUDED.custo_unitario, margem_atual = EXCLUDED.margem_atual,
         margem_no_price_to_win = EXCLUDED.margem_no_price_to_win, atualizado_em = now()`,
      [
        lojaId,
        l.itemId,
        l.titulo,
        l.thumbnail,
        l.permalink,
        l.status,
        l.precoAtual,
        l.priceToWin,
        l.sku,
        l.custoUnitario,
        l.margemAtual,
        l.margemNoPriceToWin,
      ]
    );
  }

  await pool.query("DELETE FROM agente_catalogo_snapshot WHERE loja_id = $1 AND item_id != ALL($2::text[])", [
    lojaId,
    itens.map((l) => l.itemId),
  ]);
}

// Monta o resumo em texto corrido por código puro (sem IA) — os números já
// dizem tudo (vale baixar ou não), não tem julgamento nenhum a fazer, só
// formatar frase. Mesmo formato visual dos outros agentes (texto corrido,
// sem card colorido por item), sem gastar chamada de IA pra isso.
function montarTextoCatalogo(loja: Loja, itens: ItemCatalogoInterno[]): string {
  if (itens.length === 0) {
    return `Nenhum anúncio de catálogo perdendo a disputa do "Comprar" agora em ${loja.nome}.`;
  }

  const valeBaixar = itens
    .filter((l) => l.margemNoPriceToWin !== null && l.margemNoPriceToWin > 0)
    .sort((a, b) => (b.margemNoPriceToWin as number) - (a.margemNoPriceToWin as number));
  const naoVale = itens
    .filter((l) => l.margemNoPriceToWin !== null && l.margemNoPriceToWin <= 0)
    .sort((a, b) => (a.margemNoPriceToWin as number) - (b.margemNoPriceToWin as number));
  const semCusto = itens.filter((l) => l.margemNoPriceToWin === null);

  const partes: string[] = [];
  partes.push(
    `${loja.nome} tem ${itens.length} anúncio${itens.length !== 1 ? "s" : ""} de catálogo perdendo a disputa do "Comprar" agora.`
  );

  if (valeBaixar.length > 0) {
    const frases = valeBaixar.map(
      (l) =>
        `"${l.titulo}" de ${formatCurrency(l.precoAtual)} para ${formatCurrency(l.priceToWin as number)} (sobra ${formatCurrency(l.margemNoPriceToWin as number)} de margem)`
    );
    partes.push(`Vale baixar o preço em: ${frases.join("; ")}.`);
  }

  if (naoVale.length > 0) {
    const frases = naoVale.map(
      (l) => `"${l.titulo}" (margem no price_to_win ficaria ${formatCurrency(l.margemNoPriceToWin as number)})`
    );
    partes.push(`Não vale a briga em: ${frases.join("; ")}.`);
  }

  if (semCusto.length > 0) {
    const titulos = semCusto.map((l) => `"${l.titulo}"`).join(", ");
    partes.push(`Sem custo cadastrado pra saber se compensa: ${titulos}.`);
  }

  return partes.join(" ");
}

export async function capturarCatalogoDeTodasLojas(): Promise<void> {
  const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null && LOJAS_AGENTE.includes(l.id));
  const produtos = await listarProdutos();
  const custoPorSku = new Map(produtos.map((p) => [normalizarSku(p.sku), p.custo]));

  for (const loja of lojas) {
    try {
      const itens = await coletarCatalogoDaLoja(loja, custoPorSku);
      await gravarSnapshot(loja.id, itens);
      await pool.query("INSERT INTO agente_catalogo_pensamentos (pensamento, loja_id) VALUES ($1, $2)", [
        montarTextoCatalogo(loja, itens),
        loja.id,
      ]);
    } catch (err) {
      console.error(`Agente de Catálogo: falha ao capturar a loja ${loja.id}:`, err);
      await pool
        .query("INSERT INTO agente_catalogo_pensamentos (pensamento, loja_id) VALUES ($1, $2)", [
          "Não consegui checar essa loja nessa rodada (falha ao buscar os dados ou ao analisar) — tento de novo na próxima checagem.",
          loja.id,
        ])
        .catch((erroInsert) => console.error(`Agente de Catálogo (loja ${loja.id}): falha ao registrar o aviso de erro:`, erroInsert));
    }
  }
}

const INTERVALO_MS = 4 * 60 * 60 * 1000; // 4h, mesmo ritmo do estoque/vendas negativas

export function iniciarSnapshotCatalogo(): void {
  capturarCatalogoDeTodasLojas()
    .then(() => console.log("Snapshot do Agente de Catálogo concluído."))
    .catch((err) => console.error("Erro no snapshot inicial do Agente de Catálogo:", err));
  setInterval(() => {
    capturarCatalogoDeTodasLojas()
      .then(() => console.log("Snapshot do Agente de Catálogo concluído."))
      .catch((err) => console.error("Erro no snapshot periódico do Agente de Catálogo:", err));
  }, INTERVALO_MS);
}

export interface PensamentoCatalogo {
  id: number;
  pensamento: string;
  criadoEm: string;
  lojaId: number | null;
  lojaNome: string | null;
}

// "limitePorLoja" (não total) — mesmo cuidado do agenteAdsService.ts: limite
// só no total deixaria a loja que roda primeiro no dia cair fora da janela
// visível conforme as outras acumulam registros mais recentes.
export async function listarPensamentosCatalogo(limitePorLoja = 10): Promise<PensamentoCatalogo[]> {
  const { rows } = await pool.query<{
    id: number;
    pensamento: string;
    criado_em: string;
    loja_id: number | null;
    loja_nome: string | null;
  }>(
    `SELECT id, pensamento, criado_em, loja_id, loja_nome
     FROM (
       SELECT p.id, p.pensamento, p.criado_em, p.loja_id, l.nome AS loja_nome,
              ROW_NUMBER() OVER (PARTITION BY p.loja_id ORDER BY p.criado_em DESC) AS posicao
       FROM agente_catalogo_pensamentos p
       LEFT JOIN lojas l ON l.id = p.loja_id
     ) recentes_por_loja
     WHERE posicao <= $1
     ORDER BY criado_em DESC`,
    [limitePorLoja]
  );
  return rows.map((r) => ({ id: r.id, pensamento: r.pensamento, criadoEm: r.criado_em, lojaId: r.loja_id, lojaNome: r.loja_nome }));
}
