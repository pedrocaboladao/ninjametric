import { pool } from "../db/pool";
import { listLojas, type Loja } from "./tokenStore";
import {
  listarItensAtivos,
  getItemsBasicInfo,
  getPriceToWin,
  getTaxaMlParaPreco,
  getFreteEstimadoPreVenda,
  type MlItemBasicInfo,
} from "./mercadoLivreApi";
import { atualizarPrecoItem } from "./mercadoLivreItems";
import { listarItensAutomatizados } from "./mercadoLivreAutomacaoPrecos";
import {
  listarOportunidades,
  aprovarOportunidade,
  iniciarBuscaOportunidades,
  obterProgressoBuscaOportunidades,
  type Oportunidade,
  type ProgressoBuscaOportunidades,
} from "./promocoesOportunidadesService";
import { listarProdutos } from "./produtosService";
import { normalizarSku } from "./financeiroService";

// Repricing automático no estilo PriceBot. Três peças:
//  1. Espelho: a cada 30 min lê todos os anúncios ativos da loja e calcula
//     margem e PREÇO MÍNIMO (o menor preço que ainda deixa a margem mínima do
//     dono depois de custo, taxa do ML, frete e imposto).
//  2. Robô de catálogo: nos anúncios de catálogo com o robô ligado, a cada
//     10 min ajusta o preço pra ganhar a disputa do "Comprar" usando o
//     price_to_win do próprio ML — sempre entre o preço mínimo e o máximo.
//  3. Promoções automáticas: entra sozinho nas promoções do ML (varridas por
//     promocoesOportunidadesService.ts) cuja margem fica acima da mínima.
// Nada disso roda sem o dono ligar: robô por anúncio, promoções por loja.
//
// Por que robô próprio e não a automatização de preços nativa do ML: testado
// ao vivo, o ML não oferece nenhuma regra de automatização pros anúncios da
// loja (ver mercadoLivreAutomacaoPrecos.ts).

// Fase de teste: só a Inga Collors. Ampliar é acrescentar o id aqui.
export const LOJAS_REPRICING = [3];

const MARGEM_MINIMA_PADRAO = 10;
const INTERVALO_SINCRONIZACAO_MS = 30 * 60 * 1000;
const ATRASO_PRIMEIRA_SINCRONIZACAO_MS = 3 * 60 * 1000;
const INTERVALO_ROBO_MS = 10 * 60 * 1000;
const VALIDADE_CUSTOS_MS = 24 * 60 * 60 * 1000;
const LIMITE_HISTORICO = 60;
// Trava contra guerra de preço com o robô de um concorrente: passou disso
// em 24h, o robô segura o preço daquele anúncio.
const MAX_MUDANCAS_POR_DIA = 12;
// Tentativa diária de subir o preço de quem está ganhando: de madrugada
// (horário de Brasília), quando perder a disputa por alguns minutos custa menos.
const HORA_SONDAGEM_INICIO = 3;
const HORA_SONDAGEM_FIM = 5;
const INTERVALO_MINIMO_SONDAGEM_MS = 20 * 60 * 60 * 1000;
const MAX_PROMOCOES_POR_RODADA = 30;

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format;
const centavos = (v: number) => Math.round((v + 1e-9) * 100) / 100;
const num = (v: string | null): number | null => (v === null ? null : Number(v));

async function comConcorrenciaLimitada<T>(itens: T[], limite: number, fn: (item: T) => Promise<void>): Promise<void> {
  let indice = 0;
  async function worker() {
    while (indice < itens.length) {
      await fn(itens[indice++]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, worker));
}

// --- Config da loja ---

export interface ConfigRepricing {
  margemMinimaPercentual: number;
  roboPausado: boolean;
  promocoesAutomaticas: boolean;
  ultimaSincronizacao: string | null;
  ultimoErro: string | null;
}

async function obterConfig(lojaId: number): Promise<ConfigRepricing> {
  await pool.query(
    "INSERT INTO repricing_config (loja_id, margem_minima_percentual) VALUES ($1, $2) ON CONFLICT (loja_id) DO NOTHING",
    [lojaId, MARGEM_MINIMA_PADRAO]
  );
  const { rows } = await pool.query<{
    margem_minima_percentual: string;
    robo_pausado: boolean;
    promocoes_automaticas: boolean;
    ultima_sincronizacao: Date | null;
    ultimo_erro: string | null;
  }>(
    `SELECT margem_minima_percentual, robo_pausado, promocoes_automaticas, ultima_sincronizacao, ultimo_erro
     FROM repricing_config WHERE loja_id = $1`,
    [lojaId]
  );
  const r = rows[0];
  return {
    margemMinimaPercentual: Number(r.margem_minima_percentual),
    roboPausado: r.robo_pausado,
    promocoesAutomaticas: r.promocoes_automaticas,
    ultimaSincronizacao: r.ultima_sincronizacao ? new Date(r.ultima_sincronizacao).toISOString() : null,
    ultimoErro: r.ultimo_erro,
  };
}

// --- Linha de anúncio ---

export interface ItemRepricing {
  itemId: string;
  titulo: string;
  thumbnail: string | null;
  permalink: string | null;
  sku: string | null;
  catalogo: boolean;
  precoAtual: number;
  emPromocao: boolean;
  catalogoStatus: string | null;
  priceToWin: number | null;
  vencedorPreco: number | null;
  catalogoMotivos: string | null;
  custoUnitario: number | null;
  taxaMl: number | null;
  freteEstimado: number | null;
  margemValor: number | null;
  margemPercentual: number | null;
  precoPiso: number | null;
  automacaoMl: boolean;
  margemMinimaPercentual: number | null;
  precoMaximo: number | null;
  roboLigado: boolean;
  ultimaAcao: string | null;
  ultimaAcaoEm: string | null;
  aviso: string | null;
}

interface Linha extends ItemRepricing {
  ativo: boolean;
  catalogoConsistente: boolean;
  custosPrecoRef: number | null;
  custosAtualizadosEm: Date | null;
  pisoChave: string | null;
  sondagemEm: Date | null;
}

// Colunas-espelho: tudo que vem do Mercado Livre ou é calculado a partir dele.
// As demais (margem_minima_percentual, preco_maximo, robo_ligado, ultima_acao,
// ultima_acao_em, sondagem_em, aviso) são do dono e do robô — a sincronização
// só lê, nunca grava, pra uma rodada em andamento não desfazer o que o dono
// acabou de ligar ou ajustar.
const COLUNAS_ESPELHO = `titulo, thumbnail, permalink, sku, catalogo, catalog_product_id, preco_atual, em_promocao,
  catalogo_status, price_to_win, vencedor_preco, catalogo_motivos, custo_unitario, taxa_ml, frete_estimado,
  custos_preco_ref, custos_atualizados_em, margem_valor, margem_percentual, preco_piso, piso_chave, automacao_ml`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function paraLinha(r: any): Linha {
  return {
    itemId: r.item_id,
    ativo: r.ativo,
    titulo: r.titulo,
    thumbnail: r.thumbnail,
    permalink: r.permalink,
    sku: r.sku,
    catalogo: r.catalogo,
    precoAtual: Number(r.preco_atual),
    emPromocao: r.em_promocao,
    catalogoStatus: r.catalogo_status,
    catalogoConsistente: true,
    priceToWin: num(r.price_to_win),
    vencedorPreco: num(r.vencedor_preco),
    catalogoMotivos: r.catalogo_motivos,
    custoUnitario: num(r.custo_unitario),
    taxaMl: num(r.taxa_ml),
    freteEstimado: num(r.frete_estimado),
    custosPrecoRef: num(r.custos_preco_ref),
    custosAtualizadosEm: r.custos_atualizados_em ? new Date(r.custos_atualizados_em) : null,
    margemValor: num(r.margem_valor),
    margemPercentual: num(r.margem_percentual),
    precoPiso: num(r.preco_piso),
    pisoChave: r.piso_chave,
    automacaoMl: r.automacao_ml,
    margemMinimaPercentual: num(r.margem_minima_percentual),
    precoMaximo: num(r.preco_maximo),
    roboLigado: r.robo_ligado,
    ultimaAcao: r.ultima_acao,
    ultimaAcaoEm: r.ultima_acao_em ? new Date(r.ultima_acao_em).toISOString() : null,
    sondagemEm: r.sondagem_em ? new Date(r.sondagem_em) : null,
    aviso: r.aviso,
  };
}

async function carregarLinha(lojaId: number, itemId: string): Promise<Linha | undefined> {
  const { rows } = await pool.query("SELECT * FROM repricing_itens WHERE loja_id = $1 AND item_id = $2", [lojaId, itemId]);
  return rows[0] ? paraLinha(rows[0]) : undefined;
}

async function gravarEspelho(lojaId: number, l: Linha, catalogProductId: string | null): Promise<void> {
  const atribuicoes = COLUNAS_ESPELHO.split(",")
    .map((c) => c.trim())
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(", ");
  await pool.query(
    `INSERT INTO repricing_itens (loja_id, item_id, ${COLUNAS_ESPELHO})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
     ON CONFLICT (loja_id, item_id) DO UPDATE SET ativo = true, ${atribuicoes}, atualizado_em = now()`,
    [
      lojaId,
      l.itemId,
      l.titulo,
      l.thumbnail,
      l.permalink,
      l.sku,
      l.catalogo,
      catalogProductId,
      l.precoAtual,
      l.emPromocao,
      l.catalogoStatus,
      l.priceToWin,
      l.vencedorPreco,
      l.catalogoMotivos,
      l.custoUnitario,
      l.taxaMl,
      l.freteEstimado,
      l.custosPrecoRef,
      l.custosAtualizadosEm,
      l.margemValor,
      l.margemPercentual,
      l.precoPiso,
      l.pisoChave,
      l.automacaoMl,
    ]
  );
}

type TipoEvento = "preco" | "robo_ligado" | "robo_desligado" | "promocao_entrou";

async function registrarHistorico(
  lojaId: number,
  item: { itemId: string; titulo: string },
  tipo: TipoEvento,
  dados: {
    origem?: "robo" | "externo";
    precoAnterior?: number;
    precoNovo?: number;
    margemPercentual?: number | null;
    detalhe?: string;
    usuarioId?: number | null;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO repricing_historico
       (loja_id, item_id, titulo, tipo, origem, preco_anterior, preco_novo, margem_percentual, detalhe, usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      lojaId,
      item.itemId,
      item.titulo,
      tipo,
      dados.origem ?? null,
      dados.precoAnterior ?? null,
      dados.precoNovo ?? null,
      dados.margemPercentual ?? null,
      dados.detalhe ?? null,
      dados.usuarioId ?? null,
    ]
  );
}

// --- Cálculo de margem e de preço mínimo ---

// SKU vale o atributo SELLER_SKU (mesmo critério de extrairSkuDoItem em
// mercadoLivreItems.ts). Anúncio com variações só tem SKU aqui se todas
// compartilham o mesmo — com SKUs diferentes cada variação teria um custo, e
// um piso único pro anúncio inteiro estaria errado pra alguma delas.
function skuDoItem(item: MlItemBasicInfo): string | null {
  const ler = (alvo: { seller_custom_field?: string | null; attributes?: Array<{ id: string; value_name?: string | null }> }) =>
    alvo.attributes?.find((a) => a.id === "SELLER_SKU")?.value_name || alvo.seller_custom_field || null;
  const doItem = ler(item);
  if (doItem) return doItem;
  const dasVariacoes = new Set((item.variations ?? []).map(ler).filter((s): s is string => !!s));
  return dasVariacoes.size === 1 ? Array.from(dasVariacoes)[0] : null;
}

// Diferente de calcularMargem (agenteCatalogoService.ts), aqui o frete por
// conta do vendedor entra na conta: como esse número vira o preço mínimo que
// o robô pode praticar sozinho, ignorar o frete deixaria o piso otimista demais.
function margemEm(preco: number, custo: number, taxaMl: number, frete: number, impostoPercentual: number): number {
  return preco - custo - taxaMl - frete - preco * (impostoPercentual / 100);
}

// Frete que o ML cobra do vendedor nesse anúncio:
//  - sem frete grátis: quem paga é o comprador, custo zero pro vendedor;
//  - frete grátis fora do Mercado Envios (ex.: tinta inflamável, que sai com
//    envio próprio — shipping.mode "not_specified"): o ML não cobra nada e não
//    tem cotação (a consulta dá 404). Entra como zero, igual o Financeiro
//    trata a venda real; o custo da entrega própria não está em sistema nenhum;
//  - frete grátis pelo Mercado Envios: estimativa da cotação. Se a consulta
//    falhar devolve null e a margem fica sem cálculo — melhor não ter piso do
//    que ter um piso que esqueceu o frete.
async function freteDoVendedor(lojaId: number, item: MlItemBasicInfo): Promise<number | null> {
  if (!item.shipping?.free_shipping) return 0;
  if (item.shipping.mode !== "me2") return 0;
  return getFreteEstimadoPreVenda(lojaId, item.id);
}

// Menor preço que ainda deixa a margem mínima. A taxa do ML pode não ser uma
// porcentagem pura em preço baixo, então parte da alíquota efetiva do preço
// atual e confere cada candidato com a taxa REAL daquele preço, refazendo a
// conta até a margem fechar. O frete é mantido no valor do preço atual mesmo
// que o piso caia de faixa — erra pro lado seguro (piso mais alto), nunca pro
// lado de vender abaixo da margem.
async function calcularPrecoPiso(
  lojaId: number,
  categoryId: string,
  listingTypeId: string,
  custo: number,
  frete: number,
  impostoPercentual: number,
  margemMinimaPercentual: number,
  aliquotaInicial: number
): Promise<number | null> {
  let aliquota = aliquotaInicial;
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const sobra = 1 - aliquota - impostoPercentual / 100 - margemMinimaPercentual / 100;
    if (sobra <= 0.01) return null;
    const candidato = Math.ceil(((custo + frete) / sobra) * 100) / 100;
    const taxa = await getTaxaMlParaPreco(lojaId, categoryId, listingTypeId, candidato);
    if (taxa === null) return null;
    const margemPercentual = (margemEm(candidato, custo, taxa, frete, impostoPercentual) / candidato) * 100;
    if (margemPercentual >= margemMinimaPercentual - 0.01) return candidato;
    aliquota = taxa / candidato;
  }
  return null;
}

// --- Espelho de um anúncio ---

interface Contexto {
  loja: Loja;
  margemPadrao: number;
  custoPorSku: Map<string, number>;
}

// automatizadosMl: ids com a automatização nativa do ML, vindos da listagem
// da conta. null = a listagem não foi feita (operação num anúncio só) ou
// falhou — mantém o que já se sabia.
async function processarItem(
  ctx: Contexto,
  item: MlItemBasicInfo,
  anterior: Linha | undefined,
  automatizadosMl: Set<string> | null
): Promise<Linha> {
  const lojaId = ctx.loja.id;
  const imposto = ctx.loja.imposto_percentual;
  const preco = item.price;
  const sku = skuDoItem(item);
  // Custo zerado na planilha é cadastro incompleto, não produto de graça —
  // tratar como custo real daria um preço mínimo perto de zero.
  const custoDaPlanilha = sku !== null ? (ctx.custoPorSku.get(normalizarSku(sku)) ?? null) : null;
  const custo = custoDaPlanilha !== null && custoDaPlanilha > 0 ? custoDaPlanilha : null;
  const emPromocao = typeof item.original_price === "number" && item.original_price > preco;

  let taxaMl: number | null = null;
  let frete: number | null = null;
  let custosAtualizadosEm: Date | null = null;
  if (custo !== null && item.category_id && item.listing_type_id) {
    const reaproveita =
      anterior !== undefined &&
      anterior.taxaMl !== null &&
      anterior.freteEstimado !== null &&
      anterior.custosPrecoRef === preco &&
      anterior.custosAtualizadosEm !== null &&
      Date.now() - anterior.custosAtualizadosEm.getTime() < VALIDADE_CUSTOS_MS;
    if (reaproveita) {
      taxaMl = anterior.taxaMl;
      frete = anterior.freteEstimado;
      custosAtualizadosEm = anterior.custosAtualizadosEm;
    } else {
      [taxaMl, frete] = await Promise.all([
        getTaxaMlParaPreco(lojaId, item.category_id, item.listing_type_id, preco),
        freteDoVendedor(lojaId, item),
      ]);
      custosAtualizadosEm = taxaMl !== null && frete !== null ? new Date() : null;
    }
  }

  const calculavel = custo !== null && taxaMl !== null && frete !== null && preco > 0;
  const margemValor = calculavel ? centavos(margemEm(preco, custo, taxaMl as number, frete as number, imposto)) : null;
  const margemPercentual = margemValor !== null ? (margemValor / preco) * 100 : null;

  const margemMinima = anterior?.margemMinimaPercentual ?? ctx.margemPadrao;
  let precoPiso: number | null = null;
  let pisoChave: string | null = null;
  if (calculavel) {
    const aliquota = (taxaMl as number) / preco;
    pisoChave = [custo, frete, imposto, margemMinima, item.category_id, item.listing_type_id, aliquota.toFixed(4)].join("|");
    precoPiso =
      anterior?.pisoChave === pisoChave && anterior.precoPiso !== null
        ? anterior.precoPiso
        : await calcularPrecoPiso(
            lojaId,
            item.category_id as string,
            item.listing_type_id as string,
            custo as number,
            frete as number,
            imposto,
            margemMinima,
            aliquota
          );
  }

  const disputa = item.catalog_listing ? await getPriceToWin(lojaId, item.id) : null;

  if (anterior?.ativo && Math.abs(anterior.precoAtual - preco) >= 0.01) {
    // A sincronização pode ter lido a linha um instante antes de o robô
    // gravar a mudança dele: nesse caso o preço "novo" é o que o próprio robô
    // acabou de registrar, não uma mudança por fora.
    const { rows: doRobo } = await pool.query(
      `SELECT 1 FROM repricing_historico
       WHERE loja_id = $1 AND item_id = $2 AND tipo = 'preco' AND origem = 'robo'
         AND preco_novo = $3 AND criado_em > now() - interval '1 hour'
       LIMIT 1`,
      [lojaId, item.id, preco]
    );
    if (doRobo.length === 0) {
      await registrarHistorico(lojaId, { itemId: item.id, titulo: item.title }, "preco", {
        origem: "externo",
        precoAnterior: anterior.precoAtual,
        precoNovo: preco,
        margemPercentual,
        detalhe: "Preço mudou fora do robô (ajuste manual, promoção ou outra ferramenta).",
      });
    }
  }

  const linha: Linha = {
    itemId: item.id,
    ativo: true,
    titulo: item.title,
    thumbnail: item.thumbnail ?? null,
    permalink: item.permalink ?? null,
    sku,
    catalogo: item.catalog_listing === true,
    precoAtual: preco,
    emPromocao,
    catalogoStatus: disputa?.status ?? null,
    catalogoConsistente: disputa?.consistente ?? true,
    priceToWin: disputa?.priceToWin ?? null,
    vencedorPreco: disputa?.precoVencedor ?? null,
    catalogoMotivos: disputa && disputa.motivos.length > 0 ? disputa.motivos.join(",") : null,
    custoUnitario: custo,
    taxaMl,
    freteEstimado: frete,
    custosPrecoRef: custosAtualizadosEm !== null ? preco : null,
    custosAtualizadosEm,
    margemValor,
    margemPercentual,
    precoPiso,
    pisoChave,
    automacaoMl: automatizadosMl ? automatizadosMl.has(item.id) : (anterior?.automacaoMl ?? false),
    margemMinimaPercentual: anterior?.margemMinimaPercentual ?? null,
    precoMaximo: anterior?.precoMaximo ?? null,
    roboLigado: anterior?.roboLigado ?? false,
    ultimaAcao: anterior?.ultimaAcao ?? null,
    ultimaAcaoEm: anterior?.ultimaAcaoEm ?? null,
    sondagemEm: anterior?.sondagemEm ?? null,
    aviso: anterior?.aviso ?? null,
  };
  await gravarEspelho(lojaId, linha, item.catalog_product_id ?? null);
  return linha;
}

async function montarContexto(lojaId: number): Promise<Contexto> {
  const loja = (await listLojas()).find((l) => l.id === lojaId);
  if (!loja || loja.ml_user_id === null) throw new Error("Loja sem conta do Mercado Livre conectada.");
  const [config, produtos] = await Promise.all([obterConfig(lojaId), listarProdutos()]);
  return {
    loja,
    margemPadrao: config.margemMinimaPercentual,
    custoPorSku: new Map(produtos.map((p) => [normalizarSku(p.sku), p.custo])),
  };
}

// Reconsulta um anúncio só, ao vivo — toda decisão (do dono ou do robô) passa
// por aqui antes, pra nunca agir em cima de preço ou custo de minutos atrás.
async function atualizarItem(lojaId: number, itemId: string): Promise<{ linha: Linha; item: MlItemBasicInfo; ctx: Contexto }> {
  const ctx = await montarContexto(lojaId);
  const item = (await getItemsBasicInfo(lojaId, [itemId])).get(itemId);
  if (!item) throw new Error("Não encontrei esse anúncio no Mercado Livre agora.");
  const linha = await processarItem(ctx, item, await carregarLinha(lojaId, itemId), null);
  return { linha, item, ctx };
}

// --- Sincronização da loja (espelho) ---

const emSincronizacao = new Set<number>();
// Pedido de sincronização que chegou com uma rodada em andamento (ex.: o dono
// mudou a margem padrão no meio dela): roda de novo assim que a atual termina,
// senão a mudança só valeria na próxima rodada agendada.
const repetirAoTerminar = new Set<number>();

export async function sincronizarLoja(lojaId: number): Promise<void> {
  if (emSincronizacao.has(lojaId)) {
    repetirAoTerminar.add(lojaId);
    return;
  }
  emSincronizacao.add(lojaId);
  try {
    const ctx = await montarContexto(lojaId);
    const itemIds = await listarItensAtivos(lojaId, ctx.loja.ml_user_id as number);
    const itens = await getItemsBasicInfo(lojaId, itemIds);

    let automatizadosMl: Set<string> | null = null;
    try {
      automatizadosMl = await listarItensAutomatizados(lojaId, ctx.loja.ml_user_id as number);
    } catch (err) {
      console.error(`Repricing: falha ao listar as automatizações nativas da loja ${lojaId}:`, err);
    }

    // A linha anterior é lida na hora de processar cada anúncio (não num lote
    // no começo): a rodada leva minutos, e o cache de taxa/frete depende do
    // que o robô gravou nesse meio tempo.
    await comConcorrenciaLimitada(Array.from(itens.values()), 5, async (item) => {
      try {
        await processarItem(ctx, item, await carregarLinha(lojaId, item.id), automatizadosMl);
      } catch (err) {
        console.error(`Repricing: falha ao sincronizar o item ${item.id} (loja ${lojaId}):`, err);
      }
    });

    // Quem saiu da lista de ativos: some da tela, mas a linha só é apagada se
    // não guarda nenhuma decisão do dono. Usa a lista de ids (não os itens
    // carregados) pra uma falha ao baixar um lote não parecer "anúncio saiu".
    if (itemIds.length > 0) {
      await pool.query("UPDATE repricing_itens SET ativo = false WHERE loja_id = $1 AND item_id != ALL($2::text[])", [
        lojaId,
        itemIds,
      ]);
      await pool.query(
        `DELETE FROM repricing_itens
         WHERE loja_id = $1 AND ativo = false AND robo_ligado = false
           AND margem_minima_percentual IS NULL AND preco_maximo IS NULL`,
        [lojaId]
      );
    }

    await pool.query(
      "UPDATE repricing_config SET ultima_sincronizacao = now(), ultimo_erro = NULL, atualizado_em = now() WHERE loja_id = $1",
      [lojaId]
    );
  } catch (err) {
    console.error(`Repricing: falha na sincronização da loja ${lojaId}:`, err);
    await pool
      .query("UPDATE repricing_config SET ultimo_erro = $2, atualizado_em = now() WHERE loja_id = $1", [
        lojaId,
        err instanceof Error ? err.message : "Falha na sincronização.",
      ])
      .catch((erroUpdate) => console.error("Repricing: falha ao registrar o erro da sincronização:", erroUpdate));
  } finally {
    emSincronizacao.delete(lojaId);
    if (repetirAoTerminar.delete(lojaId)) void sincronizarLoja(lojaId);
  }
}

// --- Robô de catálogo: a decisão ---

export interface EntradaDecisao {
  precoAtual: number;
  precoPiso: number | null;
  precoMaximo: number;
  emPromocao: boolean;
  automacaoMl: boolean;
  // winning | competing | sharing_first_place | listed | null (sem leitura)
  status: string | null;
  priceToWin: number | null;
  consistente: boolean;
  sondagemLiberada: boolean;
}

export type Decisao =
  | { tipo: "manter"; motivo: string }
  | { tipo: "alterar"; preco: number; motivo: string; sondagem: boolean };

// Função pura: dado o retrato do anúncio, diz o que o robô faz. O preço que
// sai daqui está SEMPRE entre o preço mínimo e o máximo.
export function decidirPreco(e: EntradaDecisao): Decisao {
  if (e.automacaoMl) {
    return { tipo: "manter", motivo: "Tem a automatização de preços do próprio Mercado Livre ligada — o robô não mexe." };
  }
  if (e.emPromocao) return { tipo: "manter", motivo: "Em promoção — o robô espera a promoção acabar." };
  if (e.precoPiso === null) return { tipo: "manter", motivo: "Sem preço mínimo calculável agora (custo, taxa ou frete faltando)." };
  if (e.precoPiso >= e.precoMaximo) {
    return {
      tipo: "manter",
      motivo: `O preço mínimo da sua margem (${moeda(e.precoPiso)}) alcançou o preço máximo (${moeda(e.precoMaximo)}) — aumente o máximo ou reduza a margem mínima.`,
    };
  }

  const piso = e.precoPiso;
  const limitar = (preco: number) => centavos(Math.min(Math.max(preco, piso), e.precoMaximo));
  const mover = (preco: number, motivo: string, sondagem = false): Decisao => {
    const alvo = limitar(preco);
    return Math.abs(alvo - e.precoAtual) < 0.01 ? { tipo: "manter", motivo } : { tipo: "alterar", preco: alvo, motivo, sondagem };
  };
  // Qualquer "manter" abaixo ainda respeita o piso: se o preço de hoje já
  // está abaixo do mínimo (custo subiu, margem mínima aumentou), sobe até ele.
  const manter = (motivo: string): Decisao =>
    e.precoAtual < piso - 0.005
      ? { tipo: "alterar", preco: limitar(piso), motivo: `Preço estava abaixo do mínimo da sua margem — subiu pra ${moeda(piso)}.`, sondagem: false }
      : { tipo: "manter", motivo };

  if (e.status === null) return manter("Sem leitura da disputa de catálogo agora.");
  if (!e.consistente) return manter("O Mercado Livre ainda está recalculando a disputa — aguardando.");

  if (e.status === "winning") {
    if (e.sondagemLiberada && e.precoAtual < e.precoMaximo - 0.005) {
      return mover(
        e.precoMaximo,
        "Ganhando: tentativa diária de subir pro preço máximo. Se perder a disputa, volta sozinho pro preço que ganha.",
        true
      );
    }
    return manter("Ganhando a disputa.");
  }

  if (e.status === "sharing_first_place") {
    return manter("Dividindo o 1º lugar — o robô segura o preço em vez de entrar em guerra de centavos.");
  }

  if (e.status === "competing" && e.priceToWin !== null) {
    if (e.priceToWin >= e.precoAtual - 0.005) {
      return manter("Já está no preço pra ganhar — aguardando o Mercado Livre virar a disputa.");
    }
    if (e.priceToWin >= piso) {
      return mover(e.priceToWin, `Baixou pra ${moeda(limitar(e.priceToWin))} pra ganhar a disputa (dentro da sua margem).`);
    }
    return mover(
      e.precoMaximo,
      `Não dá pra ganhar dentro da margem (precisaria de ${moeda(e.priceToWin)}; seu mínimo é ${moeda(piso)}) — fica no preço máximo.`
    );
  }

  if (e.status === "listed") {
    return mover(e.precoMaximo, "Fora da disputa por motivo que preço não resolve — fica no preço máximo.");
  }

  return manter("Perdendo, mas o Mercado Livre não informou o preço pra ganhar.");
}

function horaDeBrasilia(): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hourCycle: "h23" }).format(new Date()));
}

async function anotarAcao(lojaId: number, itemId: string, acao: string, aviso: string | null): Promise<void> {
  // ultima_acao_em só anda quando o texto muda: assim a tela mostra desde
  // quando o robô está naquela situação, não a hora da última checagem.
  await pool.query(
    `UPDATE repricing_itens
     SET ultima_acao_em = CASE WHEN ultima_acao IS DISTINCT FROM $3::text THEN now() ELSE ultima_acao_em END,
         ultima_acao = $3::text, aviso = $4
     WHERE loja_id = $1 AND item_id = $2`,
    [lojaId, itemId, acao, aviso]
  );
}

// Reconsulta o anúncio ao vivo, decide e — se for o caso — muda o preço.
async function rodarRoboNoItem(lojaId: number, itemId: string): Promise<void> {
  const { linha, item, ctx } = await atualizarItem(lojaId, itemId);
  if (!linha.roboLigado || linha.precoMaximo === null) return;

  const hora = horaDeBrasilia();
  const sondagemLiberada =
    hora >= HORA_SONDAGEM_INICIO &&
    hora < HORA_SONDAGEM_FIM &&
    (linha.sondagemEm === null || Date.now() - linha.sondagemEm.getTime() > INTERVALO_MINIMO_SONDAGEM_MS);

  const decisao = decidirPreco({
    precoAtual: linha.precoAtual,
    precoPiso: linha.precoPiso,
    precoMaximo: linha.precoMaximo,
    emPromocao: linha.emPromocao,
    automacaoMl: linha.automacaoMl,
    status: linha.catalogoStatus,
    priceToWin: linha.priceToWin,
    consistente: linha.catalogoConsistente,
    sondagemLiberada,
  });

  if (decisao.tipo === "manter") {
    await anotarAcao(lojaId, itemId, decisao.motivo, null);
    return;
  }

  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM repricing_historico
     WHERE loja_id = $1 AND item_id = $2 AND tipo = 'preco' AND origem = 'robo' AND criado_em > now() - interval '24 hours'`,
    [lojaId, itemId]
  );
  if (Number(rows[0].n) >= MAX_MUDANCAS_POR_DIA) {
    await anotarAcao(
      lojaId,
      itemId,
      `Segurou o preço: já foram ${MAX_MUDANCAS_POR_DIA} mudanças em 24h nesse anúncio (sinal de guerra de preço com outro robô).`,
      null
    );
    return;
  }

  try {
    await atualizarPrecoItem(lojaId, itemId, decisao.preco);
  } catch (err) {
    await anotarAcao(lojaId, itemId, "Tentou mudar o preço e o Mercado Livre recusou.", err instanceof Error ? err.message : "Falha ao mudar o preço.");
    return;
  }

  // Margem já no preço novo, pra tela não mostrar a do preço antigo até a
  // próxima rodada. Frete fica o mesmo; a taxa é reconsultada no preço novo.
  const taxaNova =
    item.category_id && item.listing_type_id
      ? await getTaxaMlParaPreco(lojaId, item.category_id, item.listing_type_id, decisao.preco)
      : null;
  const margemNova =
    linha.custoUnitario !== null && taxaNova !== null && linha.freteEstimado !== null
      ? centavos(margemEm(decisao.preco, linha.custoUnitario, taxaNova, linha.freteEstimado, ctx.loja.imposto_percentual))
      : null;
  const margemPercentualNova = margemNova !== null ? (margemNova / decisao.preco) * 100 : null;

  await pool.query(
    `UPDATE repricing_itens
     SET preco_atual = $3::numeric, taxa_ml = COALESCE($4::numeric, taxa_ml),
         custos_preco_ref = CASE WHEN $4::numeric IS NULL THEN NULL ELSE $3::numeric END,
         custos_atualizados_em = CASE WHEN $4::numeric IS NULL THEN NULL ELSE now() END,
         margem_valor = $5, margem_percentual = $6, ultima_acao = $7, ultima_acao_em = now(), aviso = NULL,
         sondagem_em = CASE WHEN $8::boolean THEN now() ELSE sondagem_em END, atualizado_em = now()
     WHERE loja_id = $1 AND item_id = $2`,
    [lojaId, itemId, decisao.preco, taxaNova, margemNova, margemPercentualNova, decisao.motivo, decisao.sondagem]
  );
  await registrarHistorico(lojaId, linha, "preco", {
    origem: "robo",
    precoAnterior: linha.precoAtual,
    precoNovo: decisao.preco,
    margemPercentual: margemPercentualNova,
    detalhe: decisao.motivo,
  });
}

// --- Promoções automáticas ---

function margemMinimaDaOportunidade(o: Oportunidade, margemPorItem: Map<string, number>, margemPadrao: number): number {
  return margemPorItem.get(o.itemId) ?? margemPadrao;
}

async function margensPorItem(lojaId: number): Promise<Map<string, number>> {
  const { rows } = await pool.query<{ item_id: string; margem_minima_percentual: string }>(
    "SELECT item_id, margem_minima_percentual FROM repricing_itens WHERE loja_id = $1 AND margem_minima_percentual IS NOT NULL",
    [lojaId]
  );
  return new Map(rows.map((r) => [r.item_id, Number(r.margem_minima_percentual)]));
}

// Promoção que cabe: ainda pendente, com identificador pra confirmar por API
// e com margem (já descontados custo, taxa, frete e imposto — conta feita na
// varredura de promocoesOportunidadesService.ts) igual ou acima da mínima.
function cabeNaMargem(o: Oportunidade, margemMinima: number): boolean {
  return o.promotionId !== null && o.percentualMargem !== null && o.percentualMargem >= margemMinima;
}

export interface ResultadoPromocoes {
  entrou: number;
  falhou: number;
  primeiroErro: string | null;
}

// Entra nas promoções pendentes que cabem na margem. limite protege a rodada
// automática de disparar centenas de confirmações de uma vez.
export async function entrarNasPromocoesComMargem(lojaId: number, limite: number): Promise<ResultadoPromocoes> {
  const config = await obterConfig(lojaId);
  const [oportunidades, margemPorItem] = await Promise.all([listarOportunidades(lojaId), margensPorItem(lojaId)]);
  const alvos = oportunidades
    .filter((o) => o.status === "pendente" && cabeNaMargem(o, margemMinimaDaOportunidade(o, margemPorItem, config.margemMinimaPercentual)))
    .slice(0, limite);

  const resultado: ResultadoPromocoes = { entrou: 0, falhou: 0, primeiroErro: null };
  for (const o of alvos) {
    try {
      await aprovarOportunidade(o.id, lojaId);
      resultado.entrou++;
      await registrarHistorico(lojaId, { itemId: o.itemId, titulo: o.titulo ?? o.itemId }, "promocao_entrou", {
        precoAnterior: o.precoOriginal,
        precoNovo: o.precoEscolhido,
        margemPercentual: o.percentualMargem,
        detalhe: `Entrou na promoção "${o.nome ?? o.tipo}".`,
      });
    } catch (err) {
      // aprovarOportunidade já marca a linha como 'erro' com o motivo — ela
      // sai das pendentes e não é tentada de novo até a próxima varredura.
      resultado.falhou++;
      resultado.primeiroErro ??= err instanceof Error ? err.message : "Falha ao entrar na promoção.";
    }
  }
  return resultado;
}

// --- Rodada do robô ---

const roboRodando = new Set<number>();

async function rodarRobo(lojaId: number): Promise<void> {
  if (roboRodando.has(lojaId)) return;
  roboRodando.add(lojaId);
  try {
    const config = await obterConfig(lojaId);
    if (config.roboPausado) return;

    const { rows } = await pool.query<{ item_id: string }>(
      "SELECT item_id FROM repricing_itens WHERE loja_id = $1 AND robo_ligado = true AND ativo = true",
      [lojaId]
    );
    await comConcorrenciaLimitada(rows, 2, async ({ item_id }) => {
      try {
        await rodarRoboNoItem(lojaId, item_id);
      } catch (err) {
        console.error(`Repricing: falha do robô no item ${item_id} (loja ${lojaId}):`, err);
      }
    });

    if (config.promocoesAutomaticas) {
      const r = await entrarNasPromocoesComMargem(lojaId, MAX_PROMOCOES_POR_RODADA);
      if (r.entrou > 0 || r.falhou > 0) {
        console.log(`Repricing (loja ${lojaId}): promoções automáticas — ${r.entrou} entrada(s), ${r.falhou} falha(s).`);
      }
    }
  } catch (err) {
    console.error(`Repricing: falha na rodada do robô (loja ${lojaId}):`, err);
  } finally {
    roboRodando.delete(lojaId);
  }
}

export function iniciarRepricing(): void {
  const sincronizar = () => {
    for (const lojaId of LOJAS_REPRICING) {
      sincronizarLoja(lojaId)
        .then(() => console.log(`Sincronização do Repricing concluída (loja ${lojaId}).`))
        .catch((err) => console.error(`Erro na sincronização do Repricing (loja ${lojaId}):`, err));
    }
  };
  // A primeira leitura de uma loja grande são milhares de chamadas (taxa e
  // frete de cada anúncio). Espera os outros agendadores do index.ts
  // terminarem a rajada de subida antes de começar a dela.
  setTimeout(sincronizar, ATRASO_PRIMEIRA_SINCRONIZACAO_MS);
  setInterval(sincronizar, INTERVALO_SINCRONIZACAO_MS);
  setInterval(() => {
    for (const lojaId of LOJAS_REPRICING) void rodarRobo(lojaId);
  }, INTERVALO_ROBO_MS);
}

// --- Leitura pra tela ---

export interface EventoHistorico {
  id: number;
  itemId: string;
  titulo: string;
  tipo: string;
  origem: string | null;
  precoAnterior: number | null;
  precoNovo: number | null;
  margemPercentual: number | null;
  detalhe: string | null;
  usuarioNome: string | null;
  criadoEm: string;
}

export interface PainelRepricing {
  config: ConfigRepricing;
  sincronizando: boolean;
  itens: ItemRepricing[];
  historico: EventoHistorico[];
}

export async function obterPainel(lojaId: number): Promise<PainelRepricing> {
  const config = await obterConfig(lojaId);
  const [{ rows: linhas }, { rows: eventos }] = await Promise.all([
    pool.query("SELECT * FROM repricing_itens WHERE loja_id = $1 AND ativo = true ORDER BY titulo, item_id", [lojaId]),
    pool.query(
      `SELECT h.id, h.item_id, h.titulo, h.tipo, h.origem, h.preco_anterior, h.preco_novo, h.margem_percentual, h.detalhe,
              h.criado_em, u.nome AS usuario_nome
       FROM repricing_historico h
       LEFT JOIN usuarios u ON u.id = h.usuario_id
       WHERE h.loja_id = $1
       ORDER BY h.criado_em DESC
       LIMIT $2`,
      [lojaId, LIMITE_HISTORICO]
    ),
  ]);

  return {
    config,
    sincronizando: emSincronizacao.has(lojaId),
    itens: linhas.map((r) => {
      const l = paraLinha(r);
      return {
        itemId: l.itemId,
        titulo: l.titulo,
        thumbnail: l.thumbnail,
        permalink: l.permalink,
        sku: l.sku,
        catalogo: l.catalogo,
        precoAtual: l.precoAtual,
        emPromocao: l.emPromocao,
        catalogoStatus: l.catalogoStatus,
        priceToWin: l.priceToWin,
        vencedorPreco: l.vencedorPreco,
        catalogoMotivos: l.catalogoMotivos,
        custoUnitario: l.custoUnitario,
        taxaMl: l.taxaMl,
        freteEstimado: l.freteEstimado,
        margemValor: l.margemValor,
        margemPercentual: l.margemPercentual,
        precoPiso: l.precoPiso,
        automacaoMl: l.automacaoMl,
        margemMinimaPercentual: l.margemMinimaPercentual,
        precoMaximo: l.precoMaximo,
        roboLigado: l.roboLigado,
        ultimaAcao: l.ultimaAcao,
        ultimaAcaoEm: l.ultimaAcaoEm,
        aviso: l.aviso,
      };
    }),
    historico: eventos.map((e) => ({
      id: e.id,
      itemId: e.item_id,
      titulo: e.titulo,
      tipo: e.tipo,
      origem: e.origem,
      precoAnterior: num(e.preco_anterior),
      precoNovo: num(e.preco_novo),
      margemPercentual: num(e.margem_percentual),
      detalhe: e.detalhe,
      usuarioNome: e.usuario_nome,
      criadoEm: new Date(e.criado_em).toISOString(),
    })),
  };
}

export interface PromocaoRepricing {
  id: number;
  itemId: string;
  titulo: string | null;
  permalink: string | null;
  sku: string | null;
  nome: string | null;
  tipo: string;
  precoOriginal: number;
  precoPromocional: number;
  margemPercentual: number | null;
  margemMinimaPercentual: number;
  // participando | vai_entrar | fora_da_margem | sem_custo | manual | erro | rejeitada
  situacao: string;
  erro: string | null;
}

export interface PainelPromocoes {
  automaticas: boolean;
  roboPausado: boolean;
  busca: ProgressoBuscaOportunidades;
  promocoes: PromocaoRepricing[];
}

export async function obterPainelPromocoes(lojaId: number): Promise<PainelPromocoes> {
  const config = await obterConfig(lojaId);
  const [oportunidades, margemPorItem] = await Promise.all([listarOportunidades(lojaId), margensPorItem(lojaId)]);

  return {
    automaticas: config.promocoesAutomaticas,
    roboPausado: config.roboPausado,
    busca: obterProgressoBuscaOportunidades(),
    promocoes: oportunidades.map((o) => {
      const margemMinima = margemMinimaDaOportunidade(o, margemPorItem, config.margemMinimaPercentual);
      let situacao: string;
      if (o.status === "participando" || o.status === "aprovada") situacao = "participando";
      else if (o.status === "erro") situacao = "erro";
      else if (o.status === "rejeitada") situacao = "rejeitada";
      else if (o.percentualMargem === null) situacao = "sem_custo";
      else if (o.promotionId === null) situacao = "manual";
      else situacao = cabeNaMargem(o, margemMinima) ? "vai_entrar" : "fora_da_margem";
      return {
        id: o.id,
        itemId: o.itemId,
        titulo: o.titulo,
        permalink: o.permalink,
        sku: o.sku,
        nome: o.nome,
        tipo: o.tipo,
        precoOriginal: o.precoOriginal,
        precoPromocional: o.precoEscolhido,
        margemPercentual: o.percentualMargem,
        margemMinimaPercentual: margemMinima,
        situacao,
        erro: o.erro,
      };
    }),
  };
}

// --- Ações do dono ---

export async function salvarConfig(
  lojaId: number,
  mudancas: { margemMinimaPercentual?: number; roboPausado?: boolean; promocoesAutomaticas?: boolean }
): Promise<void> {
  const atual = await obterConfig(lojaId);
  await pool.query(
    `UPDATE repricing_config
     SET margem_minima_percentual = $2, robo_pausado = $3, promocoes_automaticas = $4, atualizado_em = now()
     WHERE loja_id = $1`,
    [
      lojaId,
      mudancas.margemMinimaPercentual ?? atual.margemMinimaPercentual,
      mudancas.roboPausado ?? atual.roboPausado,
      mudancas.promocoesAutomaticas ?? atual.promocoesAutomaticas,
    ]
  );
  // A margem padrão muda o preço mínimo de todo anúncio sem margem própria —
  // a sincronização recalcula tudo.
  if (mudancas.margemMinimaPercentual !== undefined && mudancas.margemMinimaPercentual !== atual.margemMinimaPercentual) {
    void sincronizarLoja(lojaId);
  }
}

export async function buscarPromocoesAgora(lojaId: number): Promise<void> {
  await iniciarBuscaOportunidades(lojaId);
}

export async function ligarRobo(lojaId: number, itemId: string, usuarioId: number): Promise<void> {
  const { linha, item } = await atualizarItem(lojaId, itemId);
  const margemMinima = linha.margemMinimaPercentual ?? (await obterConfig(lojaId)).margemMinimaPercentual;

  if (!linha.catalogo) {
    throw new Error("O robô trabalha na disputa de catálogo, e esse anúncio não é de catálogo — o Mercado Livre não informa um preço-alvo pra ele.");
  }
  if (linha.automacaoMl) {
    throw new Error("Esse anúncio tem a automatização de preços do próprio Mercado Livre ligada. Desligue lá primeiro — com ela ligada o ML recusa mudança de preço.");
  }
  if (linha.custoUnitario === null) {
    throw new Error(
      linha.sku
        ? `O SKU ${linha.sku} não tem custo na planilha de produtos — sem custo não dá pra calcular o preço mínimo.`
        : "Esse anúncio não tem SKU (ou tem variações com SKUs diferentes) — sem SKU não dá pra achar o custo e calcular o preço mínimo."
    );
  }
  if (linha.precoPiso === null) {
    throw new Error(
      `Não consegui calcular o preço mínimo desse anúncio — pode faltar a cotação de frete, ou ${margemMinima}% de margem ser impossível com as taxas dele.`
    );
  }

  // Sem máximo definido, o máximo é o preço cheio de hoje: o robô só desce a
  // partir dele (e volta a subir até ele), nunca passa.
  const maximo = linha.precoMaximo ?? (linha.emPromocao && item.original_price ? item.original_price : linha.precoAtual);
  if (linha.precoPiso >= maximo) {
    throw new Error(
      `Pra manter ${margemMinima}% de margem o preço mínimo é ${moeda(linha.precoPiso)}, que já alcança o preço máximo (${moeda(maximo)}). Aumente o preço máximo ou reduza a margem mínima desse anúncio.`
    );
  }

  await pool.query(
    "UPDATE repricing_itens SET robo_ligado = true, preco_maximo = $3, aviso = NULL, atualizado_em = now() WHERE loja_id = $1 AND item_id = $2",
    [lojaId, itemId, maximo]
  );
  await registrarHistorico(lojaId, linha, "robo_ligado", {
    detalhe: `Faixa de trabalho: ${moeda(linha.precoPiso)} (mínimo pra ${margemMinima}% de margem) até ${moeda(maximo)}.`,
    usuarioId,
  });

  // Já age na hora em vez de esperar a próxima rodada (a menos que esteja pausado).
  if (!(await obterConfig(lojaId)).roboPausado) await rodarRoboNoItem(lojaId, itemId);
}

export async function desligarRobo(lojaId: number, itemId: string, usuarioId: number): Promise<void> {
  const linha = await carregarLinha(lojaId, itemId);
  if (!linha) throw new Error("Anúncio não encontrado.");
  await pool.query(
    "UPDATE repricing_itens SET robo_ligado = false, ultima_acao = NULL, ultima_acao_em = NULL, aviso = NULL, atualizado_em = now() WHERE loja_id = $1 AND item_id = $2",
    [lojaId, itemId]
  );
  await registrarHistorico(lojaId, linha, "robo_desligado", {
    detalhe: `Desligado pelo painel. O preço ficou em ${moeda(linha.precoAtual)}.`,
    usuarioId,
  });
}

export interface ResultadoEmMassa {
  itemId: string;
  ok: boolean;
  erro: string | null;
}

export async function alternarRoboEmMassa(
  lojaId: number,
  itemIds: string[],
  ligar: boolean,
  usuarioId: number
): Promise<ResultadoEmMassa[]> {
  const resultados: ResultadoEmMassa[] = [];
  await comConcorrenciaLimitada(itemIds, 2, async (itemId) => {
    try {
      await (ligar ? ligarRobo(lojaId, itemId, usuarioId) : desligarRobo(lojaId, itemId, usuarioId));
      resultados.push({ itemId, ok: true, erro: null });
    } catch (err) {
      resultados.push({ itemId, ok: false, erro: err instanceof Error ? err.message : "Falha." });
    }
  });
  return resultados;
}

// undefined = não mexe; null = volta pro padrão (margem da loja / sem máximo próprio).
export async function salvarAjustesItem(
  lojaId: number,
  itemId: string,
  ajustes: { margemMinimaPercentual?: number | null; precoMaximo?: number | null }
): Promise<void> {
  const linha = await carregarLinha(lojaId, itemId);
  if (!linha) throw new Error("Anúncio não encontrado.");
  const precoMaximo = ajustes.precoMaximo !== undefined ? ajustes.precoMaximo : linha.precoMaximo;
  if (linha.roboLigado && precoMaximo === null) {
    throw new Error("Com o robô ligado o anúncio precisa de um preço máximo. Desligue o robô antes de apagar o máximo.");
  }
  await pool.query(
    "UPDATE repricing_itens SET margem_minima_percentual = $3, preco_maximo = $4, atualizado_em = now() WHERE loja_id = $1 AND item_id = $2",
    [
      lojaId,
      itemId,
      ajustes.margemMinimaPercentual !== undefined ? ajustes.margemMinimaPercentual : linha.margemMinimaPercentual,
      precoMaximo,
    ]
  );
  // Recalcula o preço mínimo com a margem nova; com o robô ligado ele já
  // reage à faixa nova na hora.
  if (linha.roboLigado && !(await obterConfig(lojaId)).roboPausado) await rodarRoboNoItem(lojaId, itemId);
  else await atualizarItem(lojaId, itemId);
}
