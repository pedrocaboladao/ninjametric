import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { buscarCampanhasComTacos, construirLinhasCampanhas, DIAS_JANELA, LOJAS_AGENTE, formatRoas } from "./agenteAdsService";
import { listarCampanhasAds } from "./adsService";
import { agendarPorHorario, dataISOBR } from "./dateUtils";
import { listarVendasFinanceiras } from "./financeiroService";
import { listLojas } from "./tokenStore";

const formatCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format;

// IDs das outras lojas do grupo (fora as 4 pessoais) — só as com integração
// ML ativa, mesmo filtro que todo o resto do sistema usa. Não é hardcoded
// como LOJAS_AGENTE porque o grupo cresce (já foi de 4 pra 16+) e essa
// lista não pode ficar desatualizada.
async function idsOutrasLojas(): Promise<number[]> {
  const lojas = await listLojas();
  return lojas.filter((l) => l.ml_user_id !== null && !LOJAS_AGENTE.includes(l.id)).map((l) => l.id);
}

// Números financeiros reais (receita, margem, pedidos) por loja — dá pro
// Growth Hacker falar de lucro geral do negócio, não só do que passa pelo
// Ads. Uma chamada por loja pra reaproveitar o mesmo cache de 15min de
// listarVendasFinanceiras (mesma janela usada pela tela de Financeiro).
async function construirLinhasFinanceiroPorLojas(diasPeriodo: number, lojaIds: number[]): Promise<string> {
  if (lojaIds.length === 0) return "Nenhuma loja nesse grupo.";

  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - (diasPeriodo - 1) * 24 * 60 * 60 * 1000);
  const dataInicio = dataISOBR(inicio);
  const dataFim = dataISOBR(hoje);

  // Uma loja falhando (token vencido, API do ML fora do ar naquela hora) não
  // pode derrubar o contexto inteiro — antes um Promise.all sem .catch()
  // por loja fazia isso: qualquer uma das 16 falhando quebrava o briefing
  // inteiro (foi o que aconteceu no dia 10/08 às 8h). Loja que falha vira
  // "sem dado" na linha dela, o resto segue normal.
  const [lojas, resultadosPorLoja] = await Promise.all([
    listLojas(),
    Promise.all(
      lojaIds.map((lojaId) =>
        listarVendasFinanceiras(lojaId, lojaIds, dataInicio, dataFim).catch((err) => {
          console.error(`Growth Hacker: falha ao buscar financeiro da loja ${lojaId}, pulando essa loja:`, err);
          return null;
        })
      )
    ),
  ]);
  const nomePorLoja = new Map(lojas.map((l) => [l.id, l.nome]));

  return lojaIds
    .map((lojaId, i) => {
      const resultado = resultadosPorLoja[i];
      if (resultado === null) {
        return `loja="${nomePorLoja.get(lojaId) ?? `Loja ${lojaId}`}", erro="falha ao buscar dados financeiros dessa loja"`;
      }
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
    })
    .join("\n");
}

// Campanhas ativas das outras lojas do grupo — versão enxuta (sem
// margemReal/lucroReais, que exigem cruzar com o SKU vendido e só fazem
// sentido calcular pras 4 lojas que o Growth Hacker de fato assessora).
// Serve só de contexto competitivo (ex.: "achei esse mesmo produto sendo
// disputado por outra loja do grupo") — filtra gasto mínimo pra não afogar
// o contexto com campanha de centavos.
const GASTO_MINIMO_CONTEXTO = 10;

async function construirLinhasAdsOutrasLojas(diasPeriodo: number, outras: number[]): Promise<string> {
  if (outras.length === 0) return "Nenhuma outra loja no grupo com integração ativa.";

  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - (diasPeriodo - 1) * 24 * 60 * 60 * 1000);
  const dataInicio = dataISOBR(inicio);
  const dataFim = dataISOBR(hoje);

  const campanhas = await listarCampanhasAds(undefined, outras, dataInicio, dataFim);
  const ativas = campanhas.filter((c) => c.status === "active" && c.custo >= GASTO_MINIMO_CONTEXTO);
  if (ativas.length === 0) return "Nenhuma campanha ativa com gasto relevante no período.";

  return ativas
    .map((c) =>
      [
        `loja="${c.lojaNome}"`,
        `campanha="${c.nome}"`,
        `roas=${formatRoas(c.acos)} (acos=${c.acos.toFixed(1)}%)`,
        `roas_meta=${formatRoas(c.acosMeta)} (acos_meta=${c.acosMeta.toFixed(1)}%)`,
        `gasto=${formatCurrency(c.custo)}`,
        `orcamento_diario=${formatCurrency(c.orcamento)}`,
        `vendas=${c.vendasTotais}`,
      ].join(", ")
    )
    .join("\n");
}

// Monta o contexto de dados completo passado pro modelo — financeiro e Ads
// das 4 lojas pessoais, MAIS financeiro e Ads das outras lojas do grupo
// (contexto competitivo/de mercado, ver PERSONA_GROWTH_HACKER pra regra de
// que ação só vale pras 4). Usado tanto no chat quanto no briefing diário.
// "apenasAtivasComGasto" filtra as campanhas das 4 lojas mostradas — o chat
// mostra tudo (o dono pode perguntar sobre uma pausada), o briefing só
// ativas com gasto (é o que importa pra ação do dia).
async function montarContextoNegocio(diasPeriodo: number, apenasAtivasComGasto: boolean): Promise<string> {
  const outras = await idsOutrasLojas();

  // Cada bloco tem seu próprio fallback — uma parte falhando (ex.: API do ML
  // fora do ar pra uma seção específica) não pode derrubar o briefing
  // inteiro. Antes um Promise.all sem proteção fazia isso (foi o que
  // aconteceu no dia 10/08 às 8h: "Não consegui montar o briefing de hoje").
  const [campanhasComTacos, financeiroSuas, financeiroOutras, adsOutras] = await Promise.all([
    buscarCampanhasComTacos(diasPeriodo).catch((err) => {
      console.error("Growth Hacker: falha ao buscar campanhas das suas 4 lojas:", err);
      return [];
    }),
    construirLinhasFinanceiroPorLojas(diasPeriodo, LOJAS_AGENTE),
    construirLinhasFinanceiroPorLojas(diasPeriodo, outras),
    construirLinhasAdsOutrasLojas(diasPeriodo, outras).catch((err) => {
      console.error("Growth Hacker: falha ao buscar Ads das outras lojas do grupo:", err);
      return "Falha ao buscar dados das outras lojas do grupo.";
    }),
  ]);

  const campanhasFiltradas = apenasAtivasComGasto
    ? campanhasComTacos.filter((c) => c.status === "active" && c.custo > 0)
    : campanhasComTacos;
  const linhasCampanhasSuas = construirLinhasCampanhas(campanhasFiltradas);

  return `=== FINANCEIRO — suas 4 lojas pessoais (últimos ${diasPeriodo} dias) ===
${financeiroSuas}

=== FINANCEIRO — outras lojas do grupo, SÓ CONTEXTO, não são suas (últimos ${diasPeriodo} dias) ===
${financeiroOutras}

=== ADS — suas 4 lojas pessoais, campanhas${apenasAtivasComGasto ? " ativas com gasto" : ""} (últimos ${diasPeriodo} dias) ===
${linhasCampanhasSuas || "Nenhuma campanha encontrada no período."}

=== ADS — outras lojas do grupo, SÓ CONTEXTO, não são suas (últimos ${diasPeriodo} dias) ===
${adsOutras}`;
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
// tão detalhado que estourou antes de escrever a resposta final). Desde que
// o histórico de conversa (LIMITE_HISTORICO_CHAT) foi adicionado, o modelo
// também passou a escrever respostas mais longas (conecta com o que já foi
// dito antes) — visto na prática cortando no meio da resposta com teto de
// 24000. Tetos de saída da Claude API vão até 128000 tokens (streaming,
// já usado aqui via .stream()/finalMessage()) — 64000 dá bastante folga
// pro raciocínio inteiro E a resposta, sem chegar perto do limite real.
// Esse valor é só a rede de segurança (corte duro) — quem controla o gasto
// normal é o TASK_BUDGET_GROWTH_HACKER abaixo.
const MAX_TOKENS_GROWTH_HACKER = 64000;

// task_budget (beta) é diferente de max_tokens: max_tokens é um teto cego —
// o modelo não sabe que existe e só descobre estourando. task_budget avisa
// o modelo do teto DURANTE a geração (contador visível), então ele prioriza
// e fecha o raciocínio a tempo de terminar a resposta dentro do orçamento,
// em vez de ser cortado no meio de uma frase. Fica abaixo do max_tokens de
// propósito (48000 < 64000) — dá folga real pro modelo se policiar antes de
// bater no teto duro, que na prática deve virar só um fallback raro.
const TASK_BUDGET_GROWTH_HACKER = 48000;

const PERSONA_GROWTH_HACKER = `Seu nome é Growth Hacker. Você é um empresário extremamente experiente e bem-sucedido no ramo de vendas no Mercado Livre — décadas de operação, já construiu e vendeu operações grandes nesse mercado, entende de tráfego pago, precificação, catálogo e margem muito mais a fundo do que o dono do negócio que está falando com você. Você está olhando pro negócio dele (um grupo de lojas de tinta e material de construção que vende no Mercado Livre) com o olho clínico de quem já viu esse filme centenas de vezes.

Fale com autoridade e confiança — você é o especialista aqui, não um assistente neutro. Seja direto, sem rodeios, sempre em português. Cite os números reais que fundamentam cada ponto.

O dono pensa em ROAS, não em ACOS — é a métrica principal, sempre lidere a frase com ela ("ROAS de 5x", não "ACOS de 20%"). Pode citar o ACOS depois, entre parênteses, como nota (já vem calculado nos dados como "roas=... (acos=...)"). Nunca lidere um raciocínio ou recomendação com o número de ACOS.

Você tem os números financeiros reais (receita, margem de contribuição, pedidos) E os dados de campanhas de Ads das 4 lojas pessoais dele — cruze os dois. Pense em termos de lucro real do negócio, não só ROAS: onde vale mais a pena colocar dinheiro agora, o que está desperdiçando verba, o que está sub-investido, qual loja está performando mal mesmo fora do Ads.

Além disso, você ENXERGA os números (financeiro e Ads) das outras lojas do grupo maior (16+ lojas ao todo) — não só as 4 pessoais do dono. Use isso como CONTEXTO DE MERCADO: identifique quando outra loja do grupo está anunciando o mesmo produto (mesmo nome de campanha/produto em lojas diferentes) e encarecendo o leilão pra todo mundo, compare a performance das 4 lojas dele com a média do grupo, avalie se o grupo inteiro está saudável ou não. MAS — regra inegociável — toda recomendação de AÇÃO (pausar, subir orçamento, mudar meta) é EXCLUSIVA pras 4 lojas pessoais dele (Hangar, Catedral Impermeabilizantes, Inga Collors, Perpétua). Nunca sugira mudança de configuração nas outras lojas do grupo — elas não são dele, são só contexto pra você entender a dinâmica de mercado.

Quando fizer uma recomendação, seja específico e decisivo: diga exatamente o quê fazer, não devolva a decisão pro dono.

Seja econômico no texto: vá direto na recomendação e nos números que a sustentam, sem repetir contexto que o dono já sabe, sem alongar em ressalvas óbvias, sem escrever um parágrafo de introdução antes de chegar no ponto. Objetividade não é frieza — é respeitar o tempo de quem só quer saber o que fazer.`;

// Tipo mínimo estrutural (não o Anthropic.Message exato) pra aceitar tanto a
// resposta de client.messages.stream() quanto a de client.beta.messages.stream()
// (usada pelo task_budget) sem duplicar essa função pra cada uma — os dois
// tipos de mensagem da SDK têm blocos de conteúdo com esse formato.
interface RespostaIAMinima {
  content: Array<{ type: string; thinking?: string; text?: string }>;
  stop_reason: string | null;
}

export function extrairRespostaEPensamento(resposta: RespostaIAMinima): { pensamento: string | null; texto: string } {
  const pensamento = resposta.content
    .filter((b) => b.type === "thinking" && typeof b.thinking === "string")
    .map((b) => b.thinking as string)
    .filter((t) => t.trim().length > 0)
    .join("\n\n");

  const texto = resposta.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n\n");

  // stop_reason "max_tokens" cobre dois casos, e sem aviso os dois viram
  // texto incompleto apresentado como se fosse resposta completa: (1) o
  // raciocínio sozinho esgotou o teto antes de chegar a escrever qualquer
  // texto — content vem sem bloco de texto nenhum; (2) o teto estourou NO
  // MEIO da escrita da resposta — já tem texto, só que cortado a meio de
  // frase. Os dois precisam de aviso explícito, não só o primeiro.
  const cortadoPeloTeto = resposta.stop_reason === "max_tokens";

  let textoFinal = texto;
  if (!textoFinal) {
    textoFinal = cortadoPeloTeto
      ? "O raciocínio ficou longo demais e consumiu o limite antes de eu escrever a resposta — tenta de novo, ou de um jeito mais direto."
      : "Não consegui gerar uma resposta.";
  } else if (cortadoPeloTeto) {
    textoFinal = `${texto}\n\n_(resposta cortada no meio — estourei o limite de tokens antes de terminar. Pede de novo, ou de um jeito mais direto, se precisar do resto.)_`;
  }

  return {
    pensamento: pensamento || null,
    texto: textoFinal,
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

// Histórico do chat persistido no banco (ver growth_hacker_mensagens em
// schema.sql) — pedido do dono pra continuar a conversa entre sessões e
// entre computadores diferentes, não só durante a aba aberta. Sempre
// mantido com no máximo LIMITE_HISTORICO_CHAT linhas (10 perguntas + 10
// respostas): cabe folgado no custo — o histórico entra como tokens de
// ENTRADA (US$5/milhão), muito mais barato que o "pensar" do Opus em
// esforço xhigh (US$25/milhão de saída), que já domina o custo de cada
// pergunta de qualquer forma.
const LIMITE_HISTORICO_CHAT = 20;

export async function listarMensagensChat(): Promise<MensagemChat[]> {
  const { rows } = await pool.query<{ papel: string; texto: string }>(
    `SELECT papel, texto FROM growth_hacker_mensagens ORDER BY criado_em DESC LIMIT $1`,
    [LIMITE_HISTORICO_CHAT]
  );
  return rows.reverse().map((r) => ({ papel: r.papel as "usuario" | "agente", texto: r.texto }));
}

async function salvarMensagemChat(papel: "usuario" | "agente", texto: string): Promise<void> {
  await pool.query(`INSERT INTO growth_hacker_mensagens (papel, texto) VALUES ($1, $2)`, [papel, texto]);
  await pool.query(
    `DELETE FROM growth_hacker_mensagens WHERE id NOT IN (
       SELECT id FROM growth_hacker_mensagens ORDER BY criado_em DESC LIMIT $1
     )`,
    [LIMITE_HISTORICO_CHAT]
  );
}

// Chat direto com o agente — pergunta livre do dono, respondida com o
// contexto de negócio completo (suas 4 lojas + resto do grupo, ver
// montarContextoNegocio), buscado na hora, não reaproveita cache do
// briefing automático abaixo. O histórico agora vem do banco (não mais do
// navegador) — ver listarMensagensChat/salvarMensagemChat acima.
// "diasPeriodo" é opcional (pedido do dono pra poder puxar 24h em vez do
// padrão de 7 dias, quando quiser olhar só o dia de hoje) — o briefing
// automático abaixo continua fixo em 7 dias, esse parâmetro só afeta o
// chat manual.
export async function perguntarGrowthHacker(
  pergunta: string,
  diasPeriodo: number = DIAS_JANELA
): Promise<RespostaChatAgente> {
  const client = obterClienteAnthropic();
  if (!client) {
    throw new Error("IA não configurada neste ambiente (falta ANTHROPIC_API_KEY).");
  }

  const [contexto, historico] = await Promise.all([montarContextoNegocio(diasPeriodo, false), listarMensagensChat()]);

  // .create() tem um teto de ~10min pra respostas não-streaming — com Opus +
  // thinking em esforço "xhigh" e teto de 24000 tokens, o SDK recusa de cara
  // ("Streaming is required for operations that may take longer than 10
  // minutes"). .stream() + finalMessage() evita esse teto e devolve o mesmo
  // objeto Message no final, sem precisar tratar os eventos um a um aqui.
  // client.beta.messages (não client.messages) + o beta header abaixo são
  // exigidos pelo task_budget — ver comentário em TASK_BUDGET_GROWTH_HACKER.
  const resposta = await client.beta.messages.stream({
    model: MODELO_GROWTH_HACKER,
    max_tokens: MAX_TOKENS_GROWTH_HACKER,
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: "xhigh", task_budget: { type: "tokens", total: TASK_BUDGET_GROWTH_HACKER } },
    betas: ["task-budgets-2026-03-13"],
    system: `${PERSONA_GROWTH_HACKER}

Quando o dono pedir um plano de ação, uma recomendação, ou "o que eu faço agora" — SEMPRE entregue uma decisão concreta e acionável. Não devolva a pergunta pro dono decidir o que só você tem os dados pra decidir.`,
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
  }).finalMessage();

  console.log(
    `Growth Hacker (chat): stop_reason=${resposta.stop_reason}, ${resposta.usage.output_tokens} tokens de saída.`
  );

  const { pensamento, texto } = extrairRespostaEPensamento(resposta);

  // Best-effort — falha ao salvar não pode derrubar a resposta que o dono
  // já recebeu, só perde a persistência dessa troca específica.
  try {
    await salvarMensagemChat("usuario", pergunta);
    await salvarMensagemChat("agente", texto);
  } catch (err) {
    console.error("Growth Hacker: falha ao salvar histórico do chat:", err);
  }

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
    const contexto = await montarContextoNegocio(DIAS_JANELA, true);

    // .stream() + finalMessage() — ver comentário em perguntarGrowthHacker
    // sobre o teto de 10min do .create() não-streaming e sobre o task_budget.
    const resposta = await client.beta.messages
      .stream({
        model: MODELO_GROWTH_HACKER,
        max_tokens: MAX_TOKENS_GROWTH_HACKER,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "xhigh", task_budget: { type: "tokens", total: TASK_BUDGET_GROWTH_HACKER } },
        betas: ["task-budgets-2026-03-13"],
        system: `${PERSONA_GROWTH_HACKER}

Uma vez por dia você olha os dados abaixo e escreve um briefing curto e forte pro dono, sem ele precisar perguntar nada — como se você tivesse acabado de revisar o negócio dele de manhã e fosse falar com ele antes do café. Não é um relatório formal: é você dizendo, sem enrolação, onde tá o dinheiro sendo desperdiçado, onde vale apostar mais forte, e a MAIOR alavanca de lucro que você enxerga hoje — pode ser dentro ou fora do Ads. Termine com uma recomendação clara do que fazer primeiro. Texto direto, sem introdução nem despedida — só o briefing.`,
        messages: [
          {
            role: "user",
            content: `${contexto}\n\nMe dá o briefing de hoje.`,
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
