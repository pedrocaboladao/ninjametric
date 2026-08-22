import axios from "axios";
import { pool } from "../db/pool";
import { listLojas, type Loja } from "./tokenStore";
import {
  listarItensAtivos,
  consultarPromocoesDoItem,
  getItemsBasicInfo,
  getTaxaMlParaPreco,
  getFreteEstimadoPreVenda,
  adicionarItemCampanha,
  type MlPromocaoDoItem,
} from "./mercadoLivreApi";
import { listarProdutos } from "./produtosService";
import { normalizarSku, listarVendasFinanceiras } from "./financeiroService";
import { calcularMargem } from "./agenteCatalogoService";
import { janelaHoje } from "./dateUtils";

export interface Oportunidade {
  id: number;
  lojaId: number;
  lojaNome: string;
  itemId: string;
  titulo: string | null;
  permalink: string | null;
  sku: string | null;
  promotionId: string | null;
  tipo: string;
  nome: string | null;
  precoOriginal: number;
  precoEscolhido: number;
  custoUnitario: number | null;
  taxaMl: number | null;
  freteEstimado: number | null;
  margem: number | null;
  percentualMargem: number | null;
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
    // dealPrice é o preço final que o cliente vê — o que de fato é usado na
    // hora de aprovar (não é uma faixa pra escolher, é a proposta fixa
    // daquele offer_id específico).
    const precoEscolhido = promo.dealPrice ?? arredondarCentavos(precoOriginal * (1 - sellerPercentage / 100));

    // Validado contra o "Você recebe" real da tela de promoções do ML
    // (bateu na casa dos centavos): a taxa do ML é calculada sobre o preço
    // FINAL (com desconto), e a parte que o ML banca (meliPercentage)
    // reduz essa taxa ainda mais — não é um preço "efetivo" mais alto pra
    // recalcular a taxa em cima, como a versão anterior fazia.
    const taxaNormal = await getTaxaMlParaPreco(loja.id, info.category_id, info.listing_type_id, precoEscolhido);
    const reducaoMeli = arredondarCentavos(precoOriginal * (meliPercentage / 100));
    const taxaEfetiva = taxaNormal === null ? null : Math.max(0, taxaNormal - reducaoMeli);

    // Frete grátis: custo real só existe depois de um pedido de verdade
    // (getCustoFreteDoEnvio), então aqui é estimativa (ver
    // getFreteEstimadoPreVenda) — null (item sem config de frete grátis, ou
    // falha pontual) vira 0 pra não travar o cálculo, mas fica registrado
    // separado pra transparência.
    const freteEstimado = await getFreteEstimadoPreVenda(loja.id, itemId);

    const margemSemFrete = calcularMargem(precoEscolhido, custoUnitario, taxaEfetiva, loja.imposto_percentual);
    const margem = margemSemFrete === null ? null : arredondarCentavos(margemSemFrete - (freteEstimado ?? 0));
    const elegivel = margem !== null && margem > 0;

    try {
      await pool.query(
        `INSERT INTO promocoes_oportunidades
           (loja_id, item_id, titulo, permalink, sku, promotion_id, offer_id, tipo, nome, preco_original, preco_escolhido, custo_unitario, taxa_ml, frete_estimado, margem, elegivel, meli_percentual, seller_percentual, status, descoberto_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'pendente', now())
         ON CONFLICT (loja_id, item_id, tipo, promotion_id) DO UPDATE SET
           titulo = EXCLUDED.titulo,
           permalink = EXCLUDED.permalink,
           sku = EXCLUDED.sku,
           offer_id = EXCLUDED.offer_id,
           nome = EXCLUDED.nome,
           preco_original = EXCLUDED.preco_original,
           preco_escolhido = EXCLUDED.preco_escolhido,
           custo_unitario = EXCLUDED.custo_unitario,
           taxa_ml = EXCLUDED.taxa_ml,
           frete_estimado = EXCLUDED.frete_estimado,
           margem = EXCLUDED.margem,
           elegivel = EXCLUDED.elegivel,
           meli_percentual = EXCLUDED.meli_percentual,
           seller_percentual = EXCLUDED.seller_percentual,
           status = 'pendente',
           erro = NULL,
           descoberto_em = now()
         -- inclui 'erro' de propósito: uma nova varredura tem que poder
         -- reviver/corrigir uma linha que falhou antes (ex.: esse mesmo caso
         -- do offer_id que faltava), não só as pendentes.
         WHERE promocoes_oportunidades.status IN ('pendente', 'erro')`,
        [
          loja.id,
          itemId,
          info.title,
          info.permalink,
          skuNorm,
          promo.promotionId || null,
          promo.refId,
          promo.type,
          promo.name,
          precoOriginal,
          precoEscolhido,
          custoUnitario,
          taxaEfetiva,
          freteEstimado,
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
  permalink: string | null;
  sku: string | null;
  promotion_id: string | null;
  offer_id: string | null;
  tipo: string;
  nome: string | null;
  preco_original: string;
  preco_escolhido: string;
  custo_unitario: string | null;
  taxa_ml: string | null;
  frete_estimado: string | null;
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
  const margem = r.margem === null ? null : Number(r.margem);
  const precoEscolhido = Number(r.preco_escolhido);
  return {
    id: r.id,
    lojaId: r.loja_id,
    lojaNome: r.loja_nome,
    itemId: r.item_id,
    titulo: r.titulo,
    permalink: r.permalink,
    sku: r.sku,
    promotionId: r.promotion_id,
    tipo: r.tipo,
    nome: r.nome,
    precoOriginal: Number(r.preco_original),
    precoEscolhido,
    custoUnitario: r.custo_unitario === null ? null : Number(r.custo_unitario),
    taxaMl: r.taxa_ml === null ? null : Number(r.taxa_ml),
    freteEstimado: r.frete_estimado === null ? null : Number(r.frete_estimado),
    margem,
    // Margem de contribuição em % sobre o preço de venda (mesmo padrão de
    // fabricaDreService.ts: margem / receita) — receita aqui é o preço que
    // o cliente paga de fato (precoEscolhido).
    percentualMargem: margem === null || precoEscolhido <= 0 ? null : (margem / precoEscolhido) * 100,
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
  // "erro" pode tentar de novo (ex.: falha pontual/preço mudou) — só
  // "aprovada"/"rejeitada" ficam travadas de verdade.
  if (row.status !== "pendente" && row.status !== "erro") throw new Error("Essa oportunidade já foi decidida.");
  const promotionId = row.promotion_id;
  if (!promotionId) {
    throw new Error("Essa modalidade de promoção não tem um identificador pra confirmar via API — participe direto no Mercado Livre.");
  }

  // offer_id (ref_id) continuou dando "Offer id is required" mesmo depois de
  // salvo numa varredura — sinal de que não é um id estável, e sim algo
  // meio sessão/request (o sufixo numérico parece mudar a cada consulta).
  // Por isso busca AO VIVO, na hora de aprovar, em vez de confiar no valor
  // salvo — o que casa por promotion_id (esse sim parece estável entre
  // consultas, é só o ref_id que expira).
  const candidatasAgora = await consultarPromocoesDoItem(row.loja_id, row.item_id);
  const candidataAtual = candidatasAgora.find((p) => p.status === "candidate" && p.promotionId === promotionId);
  if (!candidataAtual) {
    const mensagem =
      "Essa proposta não existe mais como candidata no Mercado Livre (pode ter expirado ou sido substituída por outra). Rode 'Buscar oportunidades' de novo pra pegar a atual.";
    await pool.query(`UPDATE promocoes_oportunidades SET status = 'erro', erro = $2, decidido_em = now() WHERE id = $1`, [
      id,
      mensagem,
    ]);
    throw new Error(mensagem);
  }

  try {
    await adicionarItemCampanha(
      row.loja_id,
      row.item_id,
      promotionId,
      row.tipo,
      Number(row.preco_escolhido),
      candidataAtual.refId
    );
    await pool.query(`UPDATE promocoes_oportunidades SET status = 'aprovada', erro = NULL, decidido_em = now() WHERE id = $1`, [id]);
  } catch (err) {
    // Mesmo padrão de erro de criarCampanhaVendedor (promocoesService.ts) —
    // a mensagem genérica do axios ("Request failed with status code 400")
    // não diz nada; a mensagem real do Mercado Livre vem no corpo da
    // resposta.
    let mensagem = "Falha ao confirmar participação no Mercado Livre.";
    if (axios.isAxiosError(err)) {
      const corpo = err.response?.data as { message?: string; error?: string; cause?: unknown } | undefined;
      mensagem = `HTTP ${err.response?.status}: ${corpo?.message ?? corpo?.error ?? JSON.stringify(corpo) ?? err.message}`;
    } else if (err instanceof Error) {
      mensagem = err.message;
    }
    await pool.query(`UPDATE promocoes_oportunidades SET status = 'erro', erro = $2, decidido_em = now() WHERE id = $1`, [
      id,
      mensagem,
    ]);
    throw new Error(mensagem);
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

export interface ComparacaoOportunidade {
  encontrada: boolean;
  vendaOrderId: number | null;
  vendaData: string | null;
  precoRealUnitario: number | null;
  taxaMlReal: number | null;
  margemRealUnitaria: number | null;
  percentualMargemReal: number | null;
  precoPrevisto: number;
  margemPrevista: number | null;
  percentualMargemPrevista: number | null;
}

// Compara a margem PREVISTA na aprovação com a venda real que aconteceu
// depois — só existe pra calibrar se a suposição de cálculo (preço
// original * (1 - seller%), ver buscarOportunidadesNaLoja) bate com o que o
// Mercado Livre realmente liquida, já que a API nunca confirma isso antes
// de entrar na promoção. listarVendasFinanceiras já é a mesma fonte que o
// Financeiro usa (dados reais do pedido, sale_fee de verdade cobrado) —
// forcarAtualizacao=true porque aqui interessa o dado mais recente possível,
// não o cache de 15min.
export async function compararComVendaReal(
  id: number,
  lojaIdFiltro?: number,
  lojasPermitidas?: number[]
): Promise<ComparacaoOportunidade> {
  const row = await buscarOportunidade(id);
  if (!row) throw new Error("Oportunidade não encontrada.");
  if (lojaIdFiltro !== undefined && row.loja_id !== lojaIdFiltro) throw new Error("Você não tem acesso a essa loja.");
  if (lojasPermitidas !== undefined && !lojasPermitidas.includes(row.loja_id)) {
    throw new Error("Você não tem acesso a essa loja.");
  }
  const decididoEm = row.decidido_em;
  if (row.status !== "aprovada" || !decididoEm) {
    throw new Error("Só dá pra comparar oportunidades já aprovadas.");
  }

  const precoPrevisto = Number(row.preco_escolhido);
  const margemPrevista = row.margem === null ? null : Number(row.margem);
  const percentualMargemPrevista =
    margemPrevista === null || precoPrevisto <= 0 ? null : (margemPrevista / precoPrevisto) * 100;

  const dataInicio = decididoEm.slice(0, 10);
  const dataFim = janelaHoje().agora.slice(0, 10);
  const { vendas } = await listarVendasFinanceiras(row.loja_id, undefined, dataInicio, dataFim, true);

  const decididoEmMs = new Date(decididoEm).getTime();
  const vendaEncontrada = vendas
    .filter((v) => v.itemId === row.item_id && new Date(v.dataCriacao).getTime() >= decididoEmMs)
    .sort((a, b) => new Date(a.dataCriacao).getTime() - new Date(b.dataCriacao).getTime())[0];

  if (!vendaEncontrada) {
    return {
      encontrada: false,
      vendaOrderId: null,
      vendaData: null,
      precoRealUnitario: null,
      taxaMlReal: null,
      margemRealUnitaria: null,
      percentualMargemReal: null,
      precoPrevisto,
      margemPrevista,
      percentualMargemPrevista,
    };
  }

  const taxaMlRealUnitaria = vendaEncontrada.taxaMlTotal / vendaEncontrada.quantidade;
  const margemRealUnitaria =
    vendaEncontrada.margemContribuicao !== null ? vendaEncontrada.margemContribuicao / vendaEncontrada.quantidade : null;

  return {
    encontrada: true,
    vendaOrderId: vendaEncontrada.orderId,
    vendaData: vendaEncontrada.dataCriacao,
    precoRealUnitario: vendaEncontrada.valorUnitario,
    taxaMlReal: taxaMlRealUnitaria,
    margemRealUnitaria,
    percentualMargemReal:
      margemRealUnitaria !== null && vendaEncontrada.valorUnitario > 0
        ? (margemRealUnitaria / vendaEncontrada.valorUnitario) * 100
        : null,
    precoPrevisto,
    margemPrevista,
    percentualMargemPrevista,
  };
}
