import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { listLojas, type Loja } from "./tokenStore";
import { listarItensAtivos, getItemsBasicInfo, getVisitasItem, getAdvertiserId, getAnunciosAds } from "./mercadoLivreApi";
import { listarVendasFinanceiras } from "./financeiroService";
import { listarExperienciaCompraRuim } from "./experienciaCompraService";
import { janelaUltimosDias } from "./dateUtils";

const formatCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format;

// Só as 4 contas PESSOAIS do usuário — mesmo escopo dos outros agentes.
const LOJAS_AGENTE = [1, 2, 3, 4];
const DIAS_JANELA = 30;
// Mesmo piso do Agente de Conversão: abaixo disso, taxa de conversão é
// ruído estatístico, não sinal real.
const MIN_VISITAS = 20;
// Janela ampla só pra descobrir quem JÁ tem campanha (não pra métricas) —
// cobre campanhas antigas que não tiveram atividade nos últimos 30 dias,
// mas ainda existem.
const DIAS_JANELA_ADS_EXISTENTES = 90;
// Cap no que entra no prompt — mostra só os candidatos mais fortes
// (melhor conversão primeiro), evita diluir a atenção da IA com uma lista
// enorme de itens marginais.
const MAX_CANDIDATOS_NO_PROMPT = 15;

const MODELO_IA = "claude-sonnet-5";

let clienteAnthropic: Anthropic | null | undefined;
function obterClienteAnthropic(): Anthropic | null {
  if (clienteAnthropic === undefined) {
    clienteAnthropic = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;
  }
  return clienteAnthropic;
}

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

interface CandidatoAds {
  itemId: string;
  titulo: string;
  visitas: number;
  vendas: number;
  conversao: number;
  receitaTotal: number;
  margemPercentual: number | null;
  estoque: number | null;
}

// Candidato = anúncio ATIVO, sem nenhuma campanha de Ads (nos últimos
// DIAS_JANELA_ADS_EXISTENTES), com estoque, com pelo menos 1 venda orgânica
// e tráfego suficiente pra a conversão significar algo, e sem Experiência
// de Compra ruim (o Mercado Ads não roda nesses mesmo se a gente
// recomendasse — ver experienciaCompraService.ts).
async function coletarCandidatosDaLoja(loja: Loja): Promise<CandidatoAds[]> {
  const itemIds = await listarItensAtivos(loja.id, loja.ml_user_id as number);
  const itens = await getItemsBasicInfo(loja.id, itemIds);

  const hoje = new Date();
  const dataFimAds = hoje.toISOString().slice(0, 10);
  const dataInicioAds = new Date(hoje.getTime() - DIAS_JANELA_ADS_EXISTENTES * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  let itemIdsComAds = new Set<string>();
  const advertiserId = await getAdvertiserId(loja.id);
  if (advertiserId !== null) {
    try {
      const anuncios = await getAnunciosAds(loja.id, advertiserId, dataInicioAds, dataFimAds);
      itemIdsComAds = new Set(anuncios.map((a) => a.item_id));
    } catch {
      // Segue sem excluir nada — pior caso é mostrar um candidato que na
      // verdade já tem campanha, não perder a rodada inteira.
    }
  }

  const janela = janelaUltimosDias(DIAS_JANELA);
  const dataInicioVendas = janela.inicioDia.slice(0, 10);
  const dataFimVendas = janela.agora.slice(0, 10);

  const { vendas } = await listarVendasFinanceiras(loja.id, undefined, dataInicioVendas, dataFimVendas);
  const vendasPorItem = new Map<string, number>();
  const receitaPorItem = new Map<string, number>();
  const margemPorItem = new Map<string, number>();
  for (const v of vendas) {
    vendasPorItem.set(v.itemId, (vendasPorItem.get(v.itemId) ?? 0) + v.quantidade);
    receitaPorItem.set(v.itemId, (receitaPorItem.get(v.itemId) ?? 0) + v.receitaTotal);
    if (v.margemContribuicao !== null) {
      margemPorItem.set(v.itemId, (margemPorItem.get(v.itemId) ?? 0) + v.margemContribuicao);
    }
  }

  const ruins = new Set((await listarExperienciaCompraRuim(loja.id)).map((r) => r.itemId));

  const candidatosBrutos = Array.from(itens.values()).filter(
    (item) =>
      item.status === "active" &&
      !itemIdsComAds.has(item.id) &&
      !ruins.has(item.id) &&
      (item.available_quantity ?? 0) > 0 &&
      (vendasPorItem.get(item.id) ?? 0) > 0
  );

  // Visitas só aceita 1 item por chamada com data (ver getVisitasItem) —
  // concorrência limitada em vez de lote.
  const resultadosBrutos = await comConcorrenciaLimitada(candidatosBrutos, 8, async (item) => ({
    item,
    visitas: await getVisitasItem(loja.id, item.id, dataInicioVendas, dataFimVendas),
  }));

  return resultadosBrutos
    .filter((r) => (r.visitas ?? 0) >= MIN_VISITAS)
    .map(({ item, visitas }): CandidatoAds => {
      const vendasItem = vendasPorItem.get(item.id) ?? 0;
      const receitaTotal = receitaPorItem.get(item.id) ?? 0;
      const margemTotal = margemPorItem.get(item.id);
      return {
        itemId: item.id,
        titulo: item.title,
        visitas: visitas as number,
        vendas: vendasItem,
        conversao: vendasItem / (visitas as number),
        receitaTotal,
        margemPercentual: margemTotal !== undefined && receitaTotal > 0 ? (margemTotal / receitaTotal) * 100 : null,
        estoque: item.available_quantity ?? null,
      };
    })
    .sort((a, b) => b.conversao - a.conversao)
    .slice(0, MAX_CANDIDATOS_NO_PROMPT);
}

function construirLinhasCandidatos(candidatos: CandidatoAds[]): string {
  return candidatos
    .map((c) =>
      [
        `item_id=${c.itemId}`,
        `titulo="${c.titulo}"`,
        `visitas_${DIAS_JANELA}d=${c.visitas}`,
        `vendas_${DIAS_JANELA}d=${c.vendas}`,
        `conversao=${(c.conversao * 100).toFixed(2)}%`,
        `receita_${DIAS_JANELA}d=${formatCurrency(c.receitaTotal)}`,
        `margem_percentual=${c.margemPercentual !== null ? c.margemPercentual.toFixed(1) + "%" : "sem custo cadastrado"}`,
        `estoque=${c.estoque ?? "desconhecido"}`,
      ].join(", ")
    )
    .join("\n");
}

async function gerarRecomendacaoIA(loja: Loja, candidatos: CandidatoAds[]): Promise<void> {
  const client = obterClienteAnthropic();
  if (!client) return;

  if (candidatos.length === 0) {
    await pool.query("INSERT INTO agente_criacao_ads_pensamentos (pensamento, loja_id) VALUES ($1, $2)", [
      `Nenhum anúncio ativo sem campanha, com venda orgânica e pelo menos ${MIN_VISITAS} visitas nos últimos ${DIAS_JANELA} dias — nada pra recomendar agora.`,
      loja.id,
    ]);
    return;
  }

  const linhas = construirLinhasCandidatos(candidatos);

  const resposta = await client.messages.create({
    model: MODELO_IA,
    max_tokens: 2000,
    system: `Você é um analista de tráfego pago (Mercado Ads) experiente, especializado num grupo de lojas de tinta e material de construção que vendem no Mercado Livre.

Você recebe anúncios ATIVOS da loja "${loja.nome}" que ainda NÃO têm nenhuma campanha de Ads, mas já têm venda orgânica real e tráfego suficiente (mín. ${MIN_VISITAS} visitas) nos últimos ${DIAS_JANELA} dias. Sua tarefa é apontar quais têm mais chance de performar bem se o dono criar uma campanha nova pra eles.

Regras:
- Um anúncio que já converte bem organicamente (venda alta em relação à visita) tende a converter bem também com tráfego pago — esse é o sinal mais forte, priorize.
- "margem_percentual" é o teto aproximado de ACOS sustentável se virar campanha — abaixo de ~10% a margem é apertada demais pra sustentar Ads com folga, avise mesmo com boa conversão.
- Estoque baixo é risco: recomendar Ads pra algo que pode esgotar rápido desperdiça verba — cite quando o estoque for baixo perto da venda recente.
- Ordene da aposta mais forte pra mais fraca. Cite os números reais — não generalize.
- Texto direto, sem introdução nem despedida. Só o(s) parágrafo(s) da recomendação.`,
    messages: [
      {
        role: "user",
        content: `Anúncios sem campanha, candidatos a Ads novo:\n\n${linhas}\n\nRecomende.`,
      },
    ],
  });

  console.log(
    `Agente de Criação de Ads (IA): ${resposta.usage.input_tokens} tokens de entrada, ${resposta.usage.output_tokens} de saída.`
  );

  const pensamento = resposta.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .filter((t) => t.trim().length > 0)
    .join("\n\n");

  if (pensamento) {
    await pool.query("INSERT INTO agente_criacao_ads_pensamentos (pensamento, loja_id) VALUES ($1, $2)", [
      pensamento,
      loja.id,
    ]);
  }
}

export async function verificarAgenteCriacaoAds(): Promise<{ lojas: number; falhas: number }> {
  if (!obterClienteAnthropic()) {
    console.error("Agente de Criação de Ads: ANTHROPIC_API_KEY não configurada — rodada pulada.");
    return { lojas: 0, falhas: 0 };
  }

  const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null && LOJAS_AGENTE.includes(l.id));
  let lojasAnalisadas = 0;
  let falhas = 0;

  for (const loja of lojas) {
    try {
      const candidatos = await coletarCandidatosDaLoja(loja);
      await gerarRecomendacaoIA(loja, candidatos);
      lojasAnalisadas++;
    } catch (err) {
      console.error(`Agente de Criação de Ads (loja ${loja.id}): falha na checagem, loja pulada nessa rodada:`, err);
      falhas++;
      await pool
        .query("INSERT INTO agente_criacao_ads_pensamentos (pensamento, loja_id) VALUES ($1, $2)", [
          "Não consegui checar essa loja nessa rodada (falha ao buscar anúncios/visitas/vendas ou ao analisar) — tento de novo na próxima checagem.",
          loja.id,
        ])
        .catch((erroInsert) =>
          console.error(`Agente de Criação de Ads (loja ${loja.id}): falha ao registrar o aviso de erro:`, erroInsert)
        );
    }
  }

  return { lojas: lojasAnalisadas, falhas };
}

export interface PensamentoCriacaoAds {
  id: number;
  pensamento: string;
  criadoEm: string;
  lojaId: number | null;
  lojaNome: string | null;
}

// "limitePorLoja" (não total) — mesmo cuidado dos outros agentes: limite só
// no total deixaria a loja que roda primeiro cair fora da janela visível
// conforme as outras acumulam registros mais recentes.
export async function listarPensamentosCriacaoAds(limitePorLoja = 10): Promise<PensamentoCriacaoAds[]> {
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
       FROM agente_criacao_ads_pensamentos p
       LEFT JOIN lojas l ON l.id = p.loja_id
     ) recentes_por_loja
     WHERE posicao <= $1
     ORDER BY criado_em DESC`,
    [limitePorLoja]
  );
  return rows.map((r) => ({
    id: r.id,
    pensamento: r.pensamento,
    criadoEm: r.criado_em,
    lojaId: r.loja_id,
    lojaNome: r.loja_nome,
  }));
}

// Sinal de 30 dias não muda rápido o bastante pra rodar diário como os
// outros agentes — 1x/semana (segunda de manhã) é suficiente e evita gastar
// tokens de IA repetindo uma análise quase igual todo dia.
const HORARIO_VERIFICACAO = 8; // horário de Brasília
const INTERVALO_CHECAGEM_MS = 30 * 60 * 1000; // 30min

function ehSegundaFeiraEmSaoPaulo(): boolean {
  const dia = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(new Date());
  return dia === "Mon";
}

function horaEmSaoPaulo(): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(
      new Date()
    )
  );
}

export function iniciarVerificacaoAgenteCriacaoAds(): void {
  let ultimaSemanaChecada = "";
  setInterval(async () => {
    if (!ehSegundaFeiraEmSaoPaulo() || horaEmSaoPaulo() < HORARIO_VERIFICACAO) return;
    // Chave = ano-semana aproximada (data de hoje) — só dispara uma vez por
    // segunda-feira, mesmo checando a cada 30min o dia inteiro.
    const chaveHoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    if (chaveHoje === ultimaSemanaChecada) return;
    ultimaSemanaChecada = chaveHoje;
    try {
      const resultado = await verificarAgenteCriacaoAds();
      console.log(`Agente de Criação de Ads: ${resultado.lojas} loja(s) analisada(s), ${resultado.falhas} falha(s).`);
    } catch (err) {
      console.error("Erro na verificação do Agente de Criação de Ads:", err);
    }
  }, INTERVALO_CHECAGEM_MS);
}
