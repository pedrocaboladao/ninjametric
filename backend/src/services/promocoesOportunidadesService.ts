import { pool } from "../db/pool";
import { listLojas, type Loja } from "./tokenStore";
import {
  listarItensAtivos,
  consultarPromocoesDoItem,
  getItemsBasicInfo,
  getTaxaMlParaPreco,
  adicionarItemCampanha,
  type MlPromocaoDoItem,
} from "./mercadoLivreApi";
import { listarProdutos } from "./produtosService";
import { normalizarSku } from "./financeiroService";
import { calcularMargem } from "./agenteCatalogoService";

export interface Oportunidade {
  id: number;
  lojaId: number;
  lojaNome: string;
  itemId: string;
  titulo: string | null;
  sku: string | null;
  promotionId: string | null;
  tipo: string;
  nome: string | null;
  precoOriginal: number;
  precoEscolhido: number;
  custoUnitario: number | null;
  taxaMl: number | null;
  margem: number | null;
  elegivel: boolean;
  meliPercentual: number | null;
  sellerPercentual: number | null;
  status: string;
  erro: string | null;
  descobertoEm: string;
  decididoEm: string | null;
}

export interface ProgressoBuscaOportunidades {
  emAndamento: boolean;
  lojaAtual: string | null;
  itensVerificados: number;
  totalItens: number;
  candidatasEncontradas: number;
  itensComErro: number;
  erro: string | null;
}

let progresso: ProgressoBuscaOportunidades = {
  emAndamento: false,
  lojaAtual: null,
  itensVerificados: 0,
  totalItens: 0,
  candidatasEncontradas: 0,
  itensComErro: 0,
  erro: null,
};

export function obterProgressoBuscaOportunidades(): ProgressoBuscaOportunidades {
  return progresso;
}

// Mesmo padrão duplicado por arquivo do resto do sistema (ver
// promocoesService.ts/anunciosNegativosService.ts) — sem abstração
// compartilhada de propósito.
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

// Baixa de propósito — mesmo motivo do CONCORRENCIA_DESCOBERTA em
// promocoesService.ts (varredura item a item, sem endpoint de listagem em
// lote pro Mercado Livre).
const CONCORRENCIA = 2;

function arredondarCentavos(valor: number): number {
  return Math.round((valor + 1e-9) * 100) / 100;
}

async function buscarOportunidadesNaLoja(loja: Loja): Promise<void> {
  progresso.lojaAtual = loja.nome;
  const itemIds = await listarItensAtivos(loja.id, loja.ml_user_id as number);
  progresso.totalItens += itemIds.length;

  // Só tipo SMART entra aqui — é o único que comprovadamente tem ajuda real
  // do Mercado Livre (ver comentário na criação da tabela em schema.sql).
  // sellerPercentage !== null é a prova de que esse campo veio na resposta
  // (sem ele não dá pra saber se tem ajuda, então não vira oportunidade).
  const candidatas: { itemId: string; promo: MlPromocaoDoItem }[] = [];
  await comConcorrenciaLimitada(itemIds, CONCORRENCIA, async (itemId) => {
    try {
      const promos = await consultarPromocoesDoItem(loja.id, itemId);
      for (const p of promos) {
        if (p.status === "candidate" && p.type === "SMART" && p.sellerPercentage !== null) {
          candidatas.push({ itemId, promo: p });
        }
      }
    } catch {
      progresso.itensComErro++;
    } finally {
      progresso.itensVerificados++;
    }
  });

  progresso.candidatasEncontradas += candidatas.length;
  if (candidatas.length === 0) return;

  const produtos = await listarProdutos();
  const custoPorSku = new Map(produtos.map((p) => [normalizarSku(p.sku), p.custo]));
  const infoItens = await getItemsBasicInfo(loja.id, Array.from(new Set(candidatas.map((c) => c.itemId))));

  await comConcorrenciaLimitada(candidatas, CONCORRENCIA, async ({ itemId, promo }) => {
    const info = infoItens.get(itemId);
    if (!info || !info.category_id || !info.listing_type_id) return;

    const skuNorm = info.seller_custom_field ? normalizarSku(info.seller_custom_field) : null;
    const custoUnitario = skuNorm ? (custoPorSku.get(skuNorm) ?? null) : null;
    const precoOriginal = promo.originalPrice ?? info.price;
    const sellerPercentage = promo.sellerPercentage as number; // garantido pelo filtro acima
    const meliPercentage = promo.meliPercentage ?? 0;

    // Margem calculada só sobre a parte do desconto que sai do SEU bolso
    // (sellerPercentage) — a parte que o ML banca (meliPercentage) não
    // conta contra você. dealPrice (o preço final que o cliente vê) é o
    // que de fato é usado na hora de aprovar, mas não é a base da margem.
    const precoEfetivo = arredondarCentavos(precoOriginal * (1 - sellerPercentage / 100));
    const precoEscolhido = promo.dealPrice ?? precoEfetivo;

    const taxaMl = await getTaxaMlParaPreco(loja.id, info.category_id, info.listing_type_id, precoEfetivo);
    const margem = calcularMargem(precoEfetivo, custoUnitario, taxaMl, loja.imposto_percentual);
    const elegivel = margem !== null && margem > 0;

    try {
      await pool.query(
        `INSERT INTO promocoes_oportunidades
           (loja_id, item_id, titulo, sku, promotion_id, tipo, nome, preco_original, preco_escolhido, custo_unitario, taxa_ml, margem, elegivel, meli_percentual, seller_percentual, status, descoberto_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'pendente', now())
         ON CONFLICT (loja_id, item_id, tipo, promotion_id) DO UPDATE SET
           titulo = EXCLUDED.titulo,
           sku = EXCLUDED.sku,
           nome = EXCLUDED.nome,
           preco_original = EXCLUDED.preco_original,
           preco_escolhido = EXCLUDED.preco_escolhido,
           custo_unitario = EXCLUDED.custo_unitario,
           taxa_ml = EXCLUDED.taxa_ml,
           margem = EXCLUDED.margem,
           elegivel = EXCLUDED.elegivel,
           meli_percentual = EXCLUDED.meli_percentual,
           seller_percentual = EXCLUDED.seller_percentual,
           descoberto_em = now()
         WHERE promocoes_oportunidades.status = 'pendente'`,
        [
          loja.id,
          itemId,
          info.title,
          skuNorm,
          promo.promotionId || null,
          promo.type,
          promo.name,
          precoOriginal,
          precoEscolhido,
          custoUnitario,
          taxaMl,
          margem,
          elegivel,
          meliPercentage,
          sellerPercentage,
        ]
      );
    } catch (err) {
      console.error(`Erro ao gravar oportunidade ${itemId}/${promo.type}:`, err);
    }
  });
}

// Mesmo motivo de iniciarDescobertaCampanhas (promocoesService.ts): não
// existe endpoint do Mercado Livre pra listar "todas as promoções
// candidatas" de uma loja de uma vez, só por item — por isso a varredura é
// lenta de propósito e roda em segundo plano.
export async function iniciarBuscaOportunidades(lojaIdFiltro?: number, lojasPermitidas?: number[]): Promise<void> {
  if (progresso.emAndamento) {
    throw new Error("Já tem uma busca de oportunidades em andamento.");
  }
  progresso = {
    emAndamento: true,
    lojaAtual: null,
    itensVerificados: 0,
    totalItens: 0,
    candidatasEncontradas: 0,
    itensComErro: 0,
    erro: null,
  };

  const lojas = (await listLojas()).filter(
    (l) =>
      l.ml_user_id !== null &&
      (lojaIdFiltro === undefined || l.id === lojaIdFiltro) &&
      (lojasPermitidas === undefined || lojasPermitidas.includes(l.id))
  );

  (async () => {
    try {
      for (const loja of lojas) {
        await buscarOportunidadesNaLoja(loja);
      }
    } catch (err) {
      progresso.erro = err instanceof Error ? err.message : "Falha na busca de oportunidades.";
    } finally {
      progresso.emAndamento = false;
      progresso.lojaAtual = null;
    }
  })();
}

interface OportunidadeRow {
  id: number;
  loja_id: number;
  loja_nome: string;
  item_id: string;
  titulo: string | null;
  sku: string | null;
  promotion_id: string | null;
  tipo: string;
  nome: string | null;
  preco_original: string;
  preco_escolhido: string;
  custo_unitario: string | null;
  taxa_ml: string | null;
  margem: string | null;
  elegivel: boolean;
  meli_percentual: string | null;
  seller_percentual: string | null;
  status: string;
  erro: string | null;
  descoberto_em: string;
  decidido_em: string | null;
}

function mapearOportunidade(r: OportunidadeRow): Oportunidade {
  return {
    id: r.id,
    lojaId: r.loja_id,
    lojaNome: r.loja_nome,
    itemId: r.item_id,
    titulo: r.titulo,
    sku: r.sku,
    promotionId: r.promotion_id,
    tipo: r.tipo,
    nome: r.nome,
    precoOriginal: Number(r.preco_original),
    precoEscolhido: Number(r.preco_escolhido),
    custoUnitario: r.custo_unitario === null ? null : Number(r.custo_unitario),
    taxaMl: r.taxa_ml === null ? null : Number(r.taxa_ml),
    margem: r.margem === null ? null : Number(r.margem),
    elegivel: r.elegivel,
    meliPercentual: r.meli_percentual === null ? null : Number(r.meli_percentual),
    sellerPercentual: r.seller_percentual === null ? null : Number(r.seller_percentual),
    status: r.status,
    erro: r.erro,
    descobertoEm: r.descoberto_em,
    decididoEm: r.decidido_em,
  };
}

export async function listarOportunidades(lojaIdFiltro?: number, lojasPermitidas?: number[]): Promise<Oportunidade[]> {
  const condicoes: string[] = [];
  const params: unknown[] = [];

  if (lojaIdFiltro !== undefined) {
    params.push(lojaIdFiltro);
    condicoes.push(`o.loja_id = $${params.length}`);
  } else if (lojasPermitidas !== undefined) {
    if (lojasPermitidas.length === 0) return [];
    params.push(lojasPermitidas);
    condicoes.push(`o.loja_id = ANY($${params.length})`);
  }

  const where = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";
  const { rows } = await pool.query<OportunidadeRow>(
    `SELECT o.*, l.nome AS loja_nome
     FROM promocoes_oportunidades o
     JOIN lojas l ON l.id = o.loja_id
     ${where}
     ORDER BY o.elegivel DESC, o.margem DESC NULLS LAST, o.descoberto_em DESC`,
    params
  );
  return rows.map(mapearOportunidade);
}

async function buscarOportunidade(id: number): Promise<OportunidadeRow | null> {
  const { rows } = await pool.query<OportunidadeRow>(
    `SELECT o.*, l.nome AS loja_nome FROM promocoes_oportunidades o JOIN lojas l ON l.id = o.loja_id WHERE o.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

// Ação real no Mercado Livre — muda preço/participação de um anúncio ativo.
// Só chamada quando o dono clica em "Aprovar" na tela, nunca automaticamente.
export async function aprovarOportunidade(id: number, lojaIdFiltro?: number, lojasPermitidas?: number[]): Promise<void> {
  const row = await buscarOportunidade(id);
  if (!row) throw new Error("Oportunidade não encontrada.");
  if (lojaIdFiltro !== undefined && row.loja_id !== lojaIdFiltro) throw new Error("Você não tem acesso a essa loja.");
  if (lojasPermitidas !== undefined && !lojasPermitidas.includes(row.loja_id)) {
    throw new Error("Você não tem acesso a essa loja.");
  }
  if (row.status !== "pendente") throw new Error("Essa oportunidade já foi decidida.");
  const promotionId = row.promotion_id;
  if (!promotionId) {
    throw new Error("Essa modalidade de promoção não tem um identificador pra confirmar via API — participe direto no Mercado Livre.");
  }

  try {
    await adicionarItemCampanha(row.loja_id, row.item_id, promotionId, row.tipo, Number(row.preco_escolhido));
    await pool.query(`UPDATE promocoes_oportunidades SET status = 'aprovada', decidido_em = now() WHERE id = $1`, [id]);
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : "Falha ao confirmar participação no Mercado Livre.";
    await pool.query(`UPDATE promocoes_oportunidades SET status = 'erro', erro = $2, decidido_em = now() WHERE id = $1`, [
      id,
      mensagem,
    ]);
    throw err;
  }
}

export async function rejeitarOportunidade(id: number, lojaIdFiltro?: number, lojasPermitidas?: number[]): Promise<void> {
  const row = await buscarOportunidade(id);
  if (!row) throw new Error("Oportunidade não encontrada.");
  if (lojaIdFiltro !== undefined && row.loja_id !== lojaIdFiltro) throw new Error("Você não tem acesso a essa loja.");
  if (lojasPermitidas !== undefined && !lojasPermitidas.includes(row.loja_id)) {
    throw new Error("Você não tem acesso a essa loja.");
  }
  await pool.query(`UPDATE promocoes_oportunidades SET status = 'rejeitada', decidido_em = now() WHERE id = $1`, [id]);
}

// Só apaga o rastreamento no painel — não mexe em nada real no Mercado
// Livre (mesmo comportamento de limparCampanhas em promocoesService.ts).
export async function limparOportunidades(lojaIdFiltro?: number, lojasPermitidas?: number[]): Promise<number> {
  const lojas = (await listLojas()).filter(
    (l) => (lojaIdFiltro === undefined || l.id === lojaIdFiltro) && (lojasPermitidas === undefined || lojasPermitidas.includes(l.id))
  );
  const lojaIds = lojas.map((l) => l.id);
  if (lojaIds.length === 0) return 0;
  const { rowCount } = await pool.query("DELETE FROM promocoes_oportunidades WHERE loja_id = ANY($1)", [lojaIds]);
  return rowCount ?? 0;
}
