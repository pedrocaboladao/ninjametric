import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import { listLojas, type Loja } from "./tokenStore";
import { getAdvertiserId, getAnunciosAds, getItemsBasicInfo } from "./mercadoLivreApi";
import { normalizarSku } from "./financeiroService";
import { dataISOBR } from "./dateUtils";
import { listarCampanhasAds } from "./adsService";
import { listarReceitaRealPorCampanha } from "./tacosService";
import {
  LOJAS_AGENTE,
  DIAS_JANELA,
  buscarCampanhasComTacos,
  construirLinhasCampanhas,
  type CampanhaComTacos,
} from "./agenteAdsService";
import { extrairRespostaEPensamento, type MensagemChat, type RespostaChatAgente } from "./growthHackerService";

const formatCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format;

async function idsOutrasLojas(): Promise<number[]> {
  const lojas = await listLojas();
  return lojas.filter((l) => l.ml_user_id !== null && !LOJAS_AGENTE.includes(l.id)).map((l) => l.id);
}

// Lucro real = margem de contribuição real (R$) menos o gasto de Ads —
// mesma fórmula de calcularLucroReal em agenteAdsService.ts (função
// privada lá, duplicada aqui de propósito em vez de exportada: é só uma
// subtração, não vale acoplar os dois arquivos por isso).
function calcularLucroReal(c: { custo: number; margemReal: number | null }): number | null {
  if (c.margemReal === null) return null;
  return c.margemReal - c.custo;
}

// Mesma lógica de buscarCampanhasComTacos (agenteAdsService.ts), mas pra
// um conjunto QUALQUER de lojas em vez de travado nas 4 pessoais — o
// Diretor de Ads precisa da mesma análise completa (ROAS/tacos real/lucro
// estimado) pras outras 12 lojas do grupo também, não só pras 4. Não
// reaproveita a função original porque ela tem LOJAS_AGENTE hardcoded por
// dentro (usada pelo Analista de Ads/Growth Hacker, que são deliberadamente
// travados nas 4 — não dá pra generalizar sem arriscar mudar o
// comportamento deles).
async function buscarCampanhasComTacosParaLojas(diasPeriodo: number, lojaIds: number[]): Promise<CampanhaComTacos[]> {
  if (lojaIds.length === 0) return [];

  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - (diasPeriodo - 1) * 24 * 60 * 60 * 1000);
  const dataInicio = dataISOBR(inicio);
  const dataFim = dataISOBR(hoje);

  const [campanhas, receitas] = await Promise.all([
    listarCampanhasAds(undefined, lojaIds, dataInicio, dataFim),
    listarReceitaRealPorCampanha(undefined, lojaIds, dataInicio, dataFim),
  ]);

  const receitaPorChave = new Map(receitas.map((r) => [`${r.lojaId}-${r.campanhaId}`, r]));

  return campanhas.map((c) => {
    const dados = receitaPorChave.get(`${c.lojaId}-${c.campanhaId}`);
    const receitaReal = dados?.receitaTotalReal ?? 0;
    const receitaBase = Math.max(receitaReal, c.vendasTotais);
    const tacosReal = receitaBase > 0 ? (c.custo / receitaBase) * 100 : null;
    const acosIdeal = dados?.acosIdeal ?? null;
    const margemReal = dados?.margemReal ?? null;
    return { ...c, tacosReal, acosIdeal, lucroReais: calcularLucroReal({ custo: c.custo, margemReal }) };
  });
}

interface EntradaRankingSku {
  lojaId: number;
  lojaNome: string;
  ehSua: boolean;
  gasto: number;
  vendas: number;
}

// Anúncios ATIVOS com gasto de uma loja, agrupados por SKU normalizado
// (mesma função de financeiroService.ts, garante bater grafias diferentes
// do mesmo SKU) — soma gasto E vendas atribuídas ao anúncio (o número que
// o próprio Mercado Livre usa como "vendas atribuídas" por anúncio), pra
// dar pra montar o ranking de quem está ganhando a disputa por aquele
// produto.
async function coletarAnunciosAtivosPorSku(
  loja: Loja,
  dataInicio: string,
  dataFim: string
): Promise<Map<string, EntradaRankingSku>> {
  const porSku = new Map<string, EntradaRankingSku>();
  const advertiserId = await getAdvertiserId(loja.id);
  if (advertiserId === null) return porSku;

  let anuncios;
  try {
    anuncios = await getAnunciosAds(loja.id, advertiserId, dataInicio, dataFim);
  } catch {
    return porSku;
  }
  const ativos = anuncios.filter((a) => a.status === "active" && a.metrics.cost > 0);
  if (ativos.length === 0) return porSku;

  const itens = await getItemsBasicInfo(loja.id, ativos.map((a) => a.item_id));

  for (const a of ativos) {
    const sku = itens.get(a.item_id)?.seller_custom_field;
    if (!sku) continue;
    const skuNorm = normalizarSku(sku);
    const atual = porSku.get(skuNorm) ?? {
      lojaId: loja.id,
      lojaNome: loja.nome,
      ehSua: LOJAS_AGENTE.includes(loja.id),
      gasto: 0,
      vendas: 0,
    };
    atual.gasto += a.metrics.cost;
    atual.vendas += a.metrics.total_amount;
    porSku.set(skuNorm, atual);
  }
  return porSku;
}

// Cruza os anúncios ativos das 16 lojas por SKU — só interessa pra "soberania"
// quando o MESMO produto tem anúncio ativo numa das 4 lojas pessoais E numa
// das outras 12 do grupo ao mesmo tempo. Devolve, por SKU em disputa, o
// RANKING (ordenado por vendas atribuídas ao Ads, desc) de quem está
// ganhando essa disputa — é o dado que sustenta a regra de "pode ajudar a
// melhorar, nunca a ultrapassar uma das suas 4" no prompt do agente.
async function calcularCanibalismo(diasPeriodo: number): Promise<Map<string, EntradaRankingSku[]>> {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - (diasPeriodo - 1) * 24 * 60 * 60 * 1000);
  const dataInicio = dataISOBR(inicio);
  const dataFim = dataISOBR(hoje);

  const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null);

  const porLoja = await Promise.all(
    lojas.map((loja) =>
      coletarAnunciosAtivosPorSku(loja, dataInicio, dataFim).catch((err) => {
        console.error(`Diretor de Ads: falha ao coletar anúncios da loja ${loja.id}, pulando essa loja:`, err);
        return new Map<string, EntradaRankingSku>();
      })
    )
  );

  const porSkuGeral = new Map<string, EntradaRankingSku[]>();
  porLoja.forEach((mapa) => {
    for (const [sku, entrada] of mapa) {
      const lista = porSkuGeral.get(sku) ?? [];
      lista.push(entrada);
      porSkuGeral.set(sku, lista);
    }
  });

  const conflitos = new Map<string, EntradaRankingSku[]>();
  for (const [sku, entradas] of porSkuGeral) {
    const temSua = entradas.some((e) => e.ehSua);
    const temOutra = entradas.some((e) => !e.ehSua);
    if (temSua && temOutra) {
      conflitos.set(
        sku,
        [...entradas].sort((a, b) => b.vendas - a.vendas)
      );
    }
  }
  return conflitos;
}

// Varrer anúncios ativos das 16 lojas (com getItemsBasicInfo por loja) é
// caro — cacheado em memória por 4h (mesmo espírito do cache de
// listarCampanhasAds/cacheFreteEnvio). Não precisa sobreviver a restart:
// só existe pra não recalcular a cada pergunta do chat.
const TTL_CANIBALISMO_MS = 4 * 60 * 60 * 1000;
let cacheCanibalismo: { data: Map<string, EntradaRankingSku[]>; expiraEm: number } | null = null;

async function obterMapaCanibalismo(diasPeriodo: number): Promise<Map<string, EntradaRankingSku[]>> {
  if (cacheCanibalismo && cacheCanibalismo.expiraEm > Date.now()) {
    return cacheCanibalismo.data;
  }
  const data = await calcularCanibalismo(diasPeriodo);
  cacheCanibalismo = { data, expiraEm: Date.now() + TTL_CANIBALISMO_MS };
  return data;
}

function construirLinhasCanibalismo(mapa: Map<string, EntradaRankingSku[]>): string {
  if (mapa.size === 0) {
    return "Nenhum produto das suas 4 lojas sendo disputado por outra loja do grupo no momento.";
  }
  const linhas: string[] = [];
  for (const [sku, ranking] of mapa) {
    const posicoes = ranking
      .map(
        (e, i) =>
          `${i + 1}º ${e.lojaNome}${e.ehSua ? " (SUA)" : ""} (vendas=${formatCurrency(e.vendas)}, gasto=${formatCurrency(e.gasto)})`
      )
      .join(" | ");
    linhas.push(`sku="${sku}": ranking por vendas via Ads — ${posicoes}`);
  }
  return linhas.join("\n");
}

// Contexto focado numa loja só — pedido explícito do dono pra poder
// "marcar a loja" e ganhar precisão numa conta específica em vez de
// sempre analisar as 16 juntas. Não recalcula o mapa de canibalismo (usa
// o mesmo cache de 4h, já cobre as 16 lojas) — só filtra as disputas que
// envolvem essa loja específica.
async function montarContextoLojaUnica(
  diasPeriodo: number,
  lojaId: number,
  canibalismoCompleto: Map<string, EntradaRankingSku[]>
): Promise<string> {
  const ehSua = LOJAS_AGENTE.includes(lojaId);
  const campanhas = await (ehSua
    ? buscarCampanhasComTacos(diasPeriodo, lojaId)
    : buscarCampanhasComTacosParaLojas(diasPeriodo, [lojaId])
  ).catch((err) => {
    console.error(`Diretor de Ads: falha ao buscar campanhas da loja ${lojaId}:`, err);
    return [];
  });

  const linhas = construirLinhasCampanhas(campanhas.filter((c) => c.status === "active" && c.custo > 0));

  const disputasDaLoja = new Map<string, EntradaRankingSku[]>();
  for (const [sku, ranking] of canibalismoCompleto) {
    if (ranking.some((e) => e.lojaId === lojaId)) disputasDaLoja.set(sku, ranking);
  }

  const lojas = await listLojas();
  const nomeLoja = lojas.find((l) => l.id === lojaId)?.nome ?? `Loja ${lojaId}`;

  return `=== ANÁLISE FOCADA — ${nomeLoja}${ehSua ? " (uma das suas 4 lojas pessoais)" : " (loja do grupo, não é sua)"}, campanhas ativas com gasto (últimos ${diasPeriodo} dias) ===
${linhas || "Nenhuma campanha ativa com gasto no período."}

=== DISPUTA PELO MESMO PRODUTO envolvendo essa loja especificamente ===
${construirLinhasCanibalismo(disputasDaLoja)}`;
}

async function montarContextoDiretorAds(diasPeriodo: number, lojaIdFiltro?: number): Promise<string> {
  const canibalismo = await obterMapaCanibalismo(diasPeriodo).catch((err) => {
    console.error("Diretor de Ads: falha ao calcular canibalismo interno:", err);
    return new Map<string, EntradaRankingSku[]>();
  });

  if (lojaIdFiltro !== undefined) {
    return montarContextoLojaUnica(diasPeriodo, lojaIdFiltro, canibalismo);
  }

  const outras = await idsOutrasLojas();

  const [campanhasSuas, campanhasOutras] = await Promise.all([
    buscarCampanhasComTacos(diasPeriodo).catch((err) => {
      console.error("Diretor de Ads: falha ao buscar campanhas das suas 4 lojas:", err);
      return [];
    }),
    buscarCampanhasComTacosParaLojas(diasPeriodo, outras).catch((err) => {
      console.error("Diretor de Ads: falha ao buscar campanhas das outras lojas do grupo:", err);
      return [];
    }),
  ]);

  const linhasSuas = construirLinhasCampanhas(campanhasSuas.filter((c) => c.status === "active" && c.custo > 0));
  const linhasOutras = construirLinhasCampanhas(campanhasOutras.filter((c) => c.status === "active" && c.custo > 0));

  return `=== ADS — suas 4 lojas pessoais, campanhas ativas com gasto (últimos ${diasPeriodo} dias) ===
${linhasSuas || "Nenhuma campanha ativa com gasto no período."}

=== ADS — outras lojas do grupo (12+), campanhas ativas com gasto (últimos ${diasPeriodo} dias) ===
${linhasOutras || "Nenhuma campanha ativa com gasto no período."}

=== DISPUTA PELO MESMO PRODUTO — quando uma das suas 4 lojas e outra loja do grupo anunciam o mesmo SKU ao mesmo tempo ===
${construirLinhasCanibalismo(canibalismo)}`;
}

let clienteAnthropic: Anthropic | null | undefined;
function obterClienteAnthropic(): Anthropic | null {
  if (clienteAnthropic === undefined) {
    clienteAnthropic = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;
  }
  return clienteAnthropic;
}

const MODELO_DIRETOR_ADS = "claude-opus-5";
const MAX_TOKENS_DIRETOR_ADS = 24000;

const PERSONA_DIRETOR_ADS = `Seu nome é Diretor de Ads do Grupo. Você é um chefão de tráfego pago (Mercado Ads) extremamente experiente, que manda executar o plano de Ads pro grupo inteiro de lojas (16+ contas) de tinta e material de construção que vendem no Mercado Livre — cruzando toda informação disponível (financeiro real, tacos, lucro estimado), do mesmo jeito que o Growth Hacker faz pras 4 lojas pessoais do dono. Só que seu escopo de ação é o grupo INTEIRO, não só as 4.

Fale com autoridade e confiança, direto, sempre em português. O dono pensa em ROAS, não ACOS — é a métrica principal, sempre lidere a frase com ela ("ROAS de 5x", não "ACOS de 20%"). Pode citar o ACOS depois, entre parênteses, como nota. Cite os números reais que fundamentam cada ponto — nunca generalize.

Você recebe os dados completos (campanhas, ROAS, ROAS meta, ROAS mínimo sustentável, lucro estimado, tacos real) tanto das 4 lojas pessoais do dono quanto das outras lojas do grupo — a mesma profundidade de análise pras 16, não uma versão simplificada só pras 12.

O objetivo é o grupo inteiro ter Ads lucrativo e com escala — você AJUDA qualquer uma das 16 lojas a melhorar, sem favoritismo entre as outras 12 (nenhuma delas é "sua", dê o melhor conselho pra cada uma só com base nos números). MAS existe uma regra de prioridade inegociável, a soberania das 4 lojas pessoais do dono (Hangar, Catedral Impermeabilizantes, Inga Collors, Perpétua):
- O dono NÃO quer isolar as outras lojas da disputa — pelo contrário, quer competição saudável, e uma loja fora das 4 PODE SIM aumentar orçamento/lance num produto que uma das 4 também vende.
- A seção "DISPUTA PELO MESMO PRODUTO" dos dados traz, pra cada SKU em disputa, o RANKING de quem vende mais via Ads entre as lojas que anunciam aquele produto (posição 1º, 2º, 3º...).
- Se uma das suas 4 lojas está em 1º lugar nesse ranking pra um SKU: você pode recomendar melhorias pra qualquer outra loja do grupo competindo nesse mesmo produto (inclusive subir orçamento/lance dela) — mas NUNCA uma configuração que faria essa outra loja ULTRAPASSAR a sua loja em 1º. Pode ajudar uma loja da última posição a chegar em 2º lugar, nunca a tomar o 1º lugar de uma loja sua.
- Se NENHUMA das suas 4 lojas está em 1º lugar num SKU em disputa (outra loja do grupo já lidera): priorize recomendar pra sua loja envolvida o que precisa fazer pra retomar a liderança — não ajude ativamente a loja que hoje lidera (que não é do dono) a se distanciar ainda mais.
- Fora de situações de disputa direta pelo mesmo produto (a maioria dos casos), não existe restrição nenhuma — ajude qualquer loja do grupo livremente.
- Em qualquer empate ou ambiguidade que envolva uma das suas 4, a decisão pende sempre pra ela.

Quando o dono pedir um plano de ação, uma recomendação, ou "o que eu faço agora" — sempre entregue uma decisão concreta e acionável. Não devolva a decisão pro dono.`;

export async function perguntarDiretorAds(
  pergunta: string,
  historico: MensagemChat[],
  lojaId?: number
): Promise<RespostaChatAgente> {
  const client = obterClienteAnthropic();
  if (!client) {
    throw new Error("IA não configurada neste ambiente (falta ANTHROPIC_API_KEY).");
  }

  const contexto = await montarContextoDiretorAds(DIAS_JANELA, lojaId);

  // .stream() + finalMessage() (não .create()) pelo mesmo motivo do Growth
  // Hacker: Opus + thinking "xhigh" + teto de 24000 tokens pode passar dos
  // ~10min que o SDK aceita em requisição não-streaming.
  const resposta = await client.messages
    .stream({
      model: MODELO_DIRETOR_ADS,
      max_tokens: MAX_TOKENS_DIRETOR_ADS,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "xhigh" },
      system: PERSONA_DIRETOR_ADS,
      messages: [
        ...historico.map((m) => ({
          role: (m.papel === "usuario" ? "user" : "assistant") as "user" | "assistant",
          content: m.texto,
        })),
        {
          role: "user" as const,
          content: `${contexto}\n\n${pergunta}`,
        },
      ],
    })
    .finalMessage();

  console.log(
    `Diretor de Ads (chat): stop_reason=${resposta.stop_reason}, ${resposta.usage.output_tokens} tokens de saída.`
  );

  const { pensamento, texto } = extrairRespostaEPensamento(resposta);
  return { pensamento, resposta: texto };
}
