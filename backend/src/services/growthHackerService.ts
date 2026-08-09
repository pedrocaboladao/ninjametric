import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { buscarCampanhasComTacos, construirLinhasCampanhas, DIAS_JANELA, LOJAS_AGENTE } from "./agenteAdsService";
import { agendarPorHorario, dataISOBR } from "./dateUtils";
import { listarVendasFinanceiras } from "./financeiroService";
import { listLojas } from "./tokenStore";

const formatCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format;

// Números financeiros reais (receita, margem, pedidos) por loja — dá pro
// Growth Hacker falar de lucro geral do negócio, não só do que passa pelo
// Ads. Uma chamada por loja (só 4) pra reaproveitar o mesmo cache de 15min
// de listarVendasFinanceiras (mesma janela usada pela tela de Financeiro).
async function construirLinhasFinanceiro(diasPeriodo: number): Promise<string> {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - (diasPeriodo - 1) * 24 * 60 * 60 * 1000);
  const dataInicio = dataISOBR(inicio);
  const dataFim = dataISOBR(hoje);

  const [lojas, resultadosPorLoja] = await Promise.all([
    listLojas(),
    Promise.all(LOJAS_AGENTE.map((lojaId) => listarVendasFinanceiras(lojaId, LOJAS_AGENTE, dataInicio, dataFim))),
  ]);
  const nomePorLoja = new Map(lojas.map((l) => [l.id, l.nome]));

  return LOJAS_AGENTE.map((lojaId, i) => {
    const resultado = resultadosPorLoja[i];
    let receitaTotal = 0;
    let margemTotal = 0;
    let itensSemCusto = 0;
    for (const v of resultado.vendas) {
      receitaTotal += v.receitaTotal;
      if (v.margemContribuicao !== null) margemTotal += v.margemContribuicao;
      else itensSemCusto++;
    }
    const margemPercentual = receitaTotal > 0 ? (margemTotal / receitaTotal) * 100 : null;

    return [
      `loja="${nomePorLoja.get(lojaId) ?? `Loja ${lojaId}`}"`,
      `receita=${formatCurrency(receitaTotal)}`,
      `margem_contribuicao=${formatCurrency(margemTotal)}`,
      `margem_percentual=${margemPercentual !== null ? margemPercentual.toFixed(1) + "%" : "sem dado"}`,
      `pedidos_aprovados=${resultado.resumoPedidos.pedidosAprovados}`,
      `pedidos_cancelados=${resultado.resumoPedidos.pedidosCancelados} (${formatCurrency(resultado.resumoPedidos.valorCancelado)} perdido)`,
      `gasto_ads=${formatCurrency(resultado.gastoAdsTotal)}`,
      itensSemCusto > 0 ? `itens_sem_custo_cadastrado=${itensSemCusto}` : null,
    ]
      .filter((v): v is string => v !== null)
      .join(", ");
  }).join("\n");
}

let clienteAnthropic: Anthropic | null | undefined;
function obterClienteAnthropic(): Anthropic | null {
  if (clienteAnthropic === undefined) {
    clienteAnthropic = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;
  }
  return clienteAnthropic;
}

// Modelo mais potente (Opus) + thinking adaptativo em esforço máximo — o
// pedido era um "empresário poderoso do ramo, que entende muito mais que o
// dono" e não uma resposta engessada. Usado tanto no briefing automático
// quanto no chat manual abaixo.
const MODELO_GROWTH_HACKER = "claude-opus-5";

// Com ~30-40 campanhas nas 4 lojas, o raciocínio em esforço "xhigh" pode
// passar de 10k tokens sozinho (visto na prática: com um teto de 8000 ficou
// tão detalhado que estourou antes de escrever a resposta final). Teto bem
// generoso pra garantir espaço pro raciocínio inteiro E a resposta depois.
const MAX_TOKENS_GROWTH_HACKER = 24000;

const PERSONA_GROWTH_HACKER = `Seu nome é Growth Hacker. Você é um empresário extremamente experiente e bem-sucedido no ramo de vendas no Mercado Livre — décadas de operação, já construiu e vendeu operações grandes nesse mercado, entende de tráfego pago, precificação, catálogo e margem muito mais a fundo do que o dono do negócio que está falando com você. Você está olhando pro negócio dele (um grupo de lojas de tinta e material de construção que vende no Mercado Livre) com o olho clínico de quem já viu esse filme centenas de vezes.

Fale com autoridade e confiança — você é o especialista aqui, não um assistente neutro. Seja direto, sem rodeios, sempre em português. Cite os números reais que fundamentam cada ponto.

Você tem os números financeiros reais (receita, margem de contribuição, pedidos) E os dados de campanhas de Ads das 4 lojas pessoais dele — cruze os dois. Pense em termos de lucro real do negócio, não só ACOS: onde vale mais a pena colocar dinheiro agora, o que está desperdiçando verba, o que está sub-investido, qual loja está performando mal mesmo fora do Ads. Quando fizer uma recomendação, seja específico e decisivo: diga exatamente o quê fazer, não devolva a decisão pro dono.`;

function extrairRespostaEPensamento(resposta: Anthropic.Message): { pensamento: string | null; texto: string } {
  const pensamento = resposta.content
    .filter((b): b is Anthropic.ThinkingBlock => b.type === "thinking")
    .map((b) => b.thinking)
    .filter((t) => t.trim().length > 0)
    .join("\n\n");

  const texto = resposta.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");

  // stop_reason "max_tokens" sem nenhum bloco de texto = o raciocínio sozinho
  // esgotou o teto antes de chegar na resposta — mensagem diferente da falha
  // genérica, pra deixar claro que é questão de teto, não erro de fato.
  const semRespostaPorTeto = !texto && resposta.stop_reason === "max_tokens";

  return {
    pensamento: pensamento || null,
    texto:
      texto ||
      (semRespostaPorTeto
        ? "O raciocínio ficou longo demais e consumiu o limite antes de eu escrever a resposta — tenta de novo, ou de um jeito mais direto."
        : "Não consegui gerar uma resposta."),
  };
}

export interface MensagemChat {
  papel: "usuario" | "agente";
  texto: string;
}

export interface RespostaChatAgente {
  pensamento: string | null;
  resposta: string;
}

// Chat direto com o agente — pergunta livre do dono, respondida com os
// dados reais e atuais das campanhas das 4 lojas pessoais como contexto
// (buscados na hora, não reaproveita cache do briefing automático abaixo).
export async function perguntarGrowthHacker(pergunta: string, historico: MensagemChat[]): Promise<RespostaChatAgente> {
  const client = obterClienteAnthropic();
  if (!client) {
    throw new Error("IA não configurada neste ambiente (falta ANTHROPIC_API_KEY).");
  }

  const [campanhasComTacos, linhasFinanceiro] = await Promise.all([
    buscarCampanhasComTacos(DIAS_JANELA),
    construirLinhasFinanceiro(DIAS_JANELA),
  ]);
  const linhasCampanhas = construirLinhasCampanhas(campanhasComTacos);

  // .create() tem um teto de ~10min pra respostas não-streaming — com Opus +
  // thinking em esforço "xhigh" e teto de 24000 tokens, o SDK recusa de cara
  // ("Streaming is required for operations that may take longer than 10
  // minutes"). .stream() + finalMessage() evita esse teto e devolve o mesmo
  // objeto Message no final, sem precisar tratar os eventos um a um aqui.
  const resposta = await client.messages.stream({
    model: MODELO_GROWTH_HACKER,
    max_tokens: MAX_TOKENS_GROWTH_HACKER,
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: "xhigh" },
    system: `${PERSONA_GROWTH_HACKER}

Quando o dono pedir um plano de ação, uma recomendação, ou "o que eu faço agora" — SEMPRE entregue uma decisão concreta e acionável. Não devolva a pergunta pro dono decidir o que só você tem os dados pra decidir.`,
    messages: [
      ...historico.map((m) => ({
        role: (m.papel === "usuario" ? "user" : "assistant") as "user" | "assistant",
        content: m.texto,
      })),
      {
        role: "user" as const,
        content: `Dados financeiros reais por loja (últimos ${DIAS_JANELA} dias):\n\n${linhasFinanceiro}\n\nDados atuais das campanhas de Ads (últimos ${DIAS_JANELA} dias):\n\n${linhasCampanhas || "Nenhuma campanha encontrada no período."}\n\n${pergunta}`,
      },
    ],
  }).finalMessage();

  console.log(
    `Growth Hacker (chat): stop_reason=${resposta.stop_reason}, ${resposta.usage.output_tokens} tokens de saída.`
  );

  const { pensamento, texto } = extrairRespostaEPensamento(resposta);
  return { pensamento, resposta: texto };
}

export interface BriefingGrowthHacker {
  id: number;
  pensamento: string;
  criadoEm: string;
}

// Briefing automático 1x/dia — olha as 4 lojas pessoais como UM negócio só
// (diferente do Analista de Ads, que analisa loja por loja) e escreve dicas
// fortes e diretas de como aumentar o lucro, não uma análise neutra de
// campanha por campanha.
export async function gerarBriefingDiario(): Promise<void> {
  const client = obterClienteAnthropic();
  if (!client) {
    console.error("Growth Hacker (briefing): ANTHROPIC_API_KEY não configurada — rodada pulada.");
    return;
  }

  try {
    const [campanhas, linhasFinanceiro] = await Promise.all([
      buscarCampanhasComTacos(DIAS_JANELA),
      construirLinhasFinanceiro(DIAS_JANELA),
    ]);
    const ativas = campanhas.filter((c) => c.status === "active" && c.custo > 0);
    const linhasCampanhas = construirLinhasCampanhas(ativas);

    // .stream() + finalMessage() — ver comentário em perguntarGrowthHacker
    // sobre o teto de 10min do .create() não-streaming.
    const resposta = await client.messages
      .stream({
        model: MODELO_GROWTH_HACKER,
        max_tokens: MAX_TOKENS_GROWTH_HACKER,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "xhigh" },
        system: `${PERSONA_GROWTH_HACKER}

Uma vez por dia você olha os dados abaixo e escreve um briefing curto e forte pro dono, sem ele precisar perguntar nada — como se você tivesse acabado de revisar o negócio dele de manhã e fosse falar com ele antes do café. Não é um relatório formal: é você dizendo, sem enrolação, onde tá o dinheiro sendo desperdiçado, onde vale apostar mais forte, e a MAIOR alavanca de lucro que você enxerga hoje — pode ser dentro ou fora do Ads. Termine com uma recomendação clara do que fazer primeiro. Texto direto, sem introdução nem despedida — só o briefing.`,
        messages: [
          {
            role: "user",
            content: `Dados financeiros reais por loja (últimos ${DIAS_JANELA} dias):\n\n${linhasFinanceiro}\n\n${
              ativas.length > 0
                ? `Campanhas de Ads ativas com gasto no período:\n\n${linhasCampanhas}`
                : "Nenhuma campanha de Ads ativa com gasto no período."
            }\n\nMe dá o briefing de hoje.`,
          },
        ],
      })
      .finalMessage();

    console.log(
      `Growth Hacker (briefing): stop_reason=${resposta.stop_reason}, ${resposta.usage.output_tokens} tokens de saída.`
    );

    const { texto } = extrairRespostaEPensamento(resposta);
    await pool.query("INSERT INTO agente_growth_hacker_pensamentos (pensamento) VALUES ($1)", [texto]);
  } catch (err) {
    console.error("Growth Hacker (briefing): falha na rodada, tenta de novo na próxima:", err);
    await pool
      .query("INSERT INTO agente_growth_hacker_pensamentos (pensamento) VALUES ($1)", [
        "Não consegui montar o briefing de hoje (falha ao buscar os dados ou ao analisar) — tento de novo amanhã.",
      ])
      .catch((erroInsert) => console.error("Growth Hacker (briefing): falha ao registrar o aviso de erro:", erroInsert));
  }
}

export async function listarBriefings(limite = 14): Promise<BriefingGrowthHacker[]> {
  const { rows } = await pool.query<{ id: number; pensamento: string; criado_em: string }>(
    "SELECT id, pensamento, criado_em FROM agente_growth_hacker_pensamentos ORDER BY criado_em DESC LIMIT $1",
    [limite]
  );
  return rows.map((r) => ({ id: r.id, pensamento: r.pensamento, criadoEm: r.criado_em }));
}

// Horário de Brasília — 1x/dia, antes do expediente.
const HORARIO_BRIEFING = [8];

export function iniciarGrowthHacker(): void {
  agendarPorHorario(HORARIO_BRIEFING, async () => {
    try {
      await gerarBriefingDiario();
      console.log("Growth Hacker (briefing): rodada concluída.");
    } catch (err) {
      console.error("Erro na rodada do Growth Hacker (briefing):", err);
    }
  });
}
