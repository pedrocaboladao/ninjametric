import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { listarCampanhasAds, type CampanhaAds } from "./adsService";
import { listarReceitaRealPorCampanha } from "./tacosService";

const formatCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format;

interface CampanhaComTacos extends CampanhaAds {
  tacosReal: number | null;
  acosIdeal: number | null;
  lucroReais: number | null;
}

function calcularLucroReais(c: { custo: number; receitaBase: number; acosIdeal: number | null }): number | null {
  if (c.acosIdeal === null) return null;
  if (c.custo === 0 && c.receitaBase === 0) return null;
  return c.receitaBase * (c.acosIdeal / 100) - c.custo;
}

interface ObservacaoGerada {
  tipo: string;
  contexto: string;
  acao: string;
}

function dataISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Análise real com IA (Claude) — pega o lugar da lógica de regras fixas
// acima quando ANTHROPIC_API_KEY está configurada. Manda os números de
// todas as campanhas ativas com gasto numa chamada só (mais barato que uma
// chamada por campanha) e pede pra IA decidir sozinha quais merecem
// atenção, com "tool use" pra garantir resposta em formato estruturado.
const MODELO_IA = "claude-sonnet-5";

let clienteAnthropic: Anthropic | null | undefined;
function obterClienteAnthropic(): Anthropic | null {
  if (clienteAnthropic === undefined) {
    clienteAnthropic = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;
  }
  return clienteAnthropic;
}

const TIPOS_VALIDOS = ["prejuizo", "semVenda", "margemSobra", "orcamentoParado", "organico", "atencao"] as const;

const FERRAMENTA_OBSERVACOES: Anthropic.Tool = {
  name: "reportar_observacoes",
  description: "Reporta as campanhas de Ads que merecem atenção agora, com explicação e ação sugerida.",
  input_schema: {
    type: "object",
    properties: {
      observacoes: {
        type: "array",
        description: "Uma entrada por campanha que merece atenção. Campanhas saudáveis não entram aqui.",
        items: {
          type: "object",
          properties: {
            loja_id: { type: "number" },
            campanha_id: { type: "string" },
            tipo: { type: "string", enum: [...TIPOS_VALIDOS] },
            contexto: { type: "string", description: "1-2 frases diretas, em português, citando os números reais da campanha." },
            acao: { type: "string", description: "Ação concreta e curta sugerida, em português." },
          },
          required: ["loja_id", "campanha_id", "tipo", "contexto", "acao"],
        },
      },
    },
    required: ["observacoes"],
  },
};

interface ObservacaoIA extends ObservacaoGerada {
  lojaId: number;
  campanhaId: string;
}

// Reaproveitado tanto na verificação automática (só campanhas ativas com
// gasto) quanto no chat do agente (todas, pra dar pro dono perguntar sobre
// qualquer campanha, inclusive pausada).
function construirLinhasCampanhas(campanhas: CampanhaComTacos[]): string {
  return campanhas
    .map((c) =>
      [
        `loja_id=${c.lojaId}`,
        `campanha_id=${c.campanhaId}`,
        `loja="${c.lojaNome}"`,
        `campanha="${c.nome}"`,
        `status=${c.status}`,
        `acos=${c.acos.toFixed(1)}%`,
        `acos_meta=${c.acosMeta.toFixed(1)}%`,
        `gasto=${formatCurrency(c.custo)}`,
        `orcamento_diario=${formatCurrency(c.orcamento)}`,
        `vendas=${c.vendasTotais}`,
        `acos_ideal_margem_real=${c.acosIdeal !== null ? c.acosIdeal.toFixed(1) + "%" : "sem custo cadastrado"}`,
        `lucro_estimado=${c.lucroReais !== null ? formatCurrency(c.lucroReais) : "sem dado"}`,
        `tacos_real=${c.tacosReal !== null ? c.tacosReal.toFixed(1) + "%" : "sem dado"}`,
      ].join(", ")
    )
    .join("\n");
}

interface HistoricoReacaoTipo {
  tipo: string;
  total: number;
  confirmadas: number;
  resolvidasSozinhas: number;
  horasMediasParaConfirmar: number | null;
}

// "Memória" prática do agente — não é a IA aprendendo de verdade (nenhum
// modelo é retreinado), é o sistema guardando como o dono historicamente
// reage a cada tipo de observação (confirma rápido? costuma ignorar e a
// situação se resolve sozinha?) e devolvendo isso como contexto extra pra
// próxima análise. Usado SÓ pra ajudar a priorizar e escrever uma ação mais
// realista — a regra de nunca esconder nada do dono é aplicada no prompt.
async function buscarHistoricoReacao(): Promise<HistoricoReacaoTipo[]> {
  const { rows } = await pool.query<{
    tipo: string;
    total: string;
    confirmadas: string;
    resolvidas_sozinhas: string;
    horas_medias: string | null;
  }>(
    `SELECT
       tipo,
       count(*)::text AS total,
       count(*) FILTER (WHERE status = 'resolvida' AND resolvido_por = 'usuario')::text AS confirmadas,
       count(*) FILTER (WHERE status = 'resolvida' AND resolvido_por = 'sistema')::text AS resolvidas_sozinhas,
       avg(EXTRACT(EPOCH FROM (resolvido_em - criado_em)) / 3600) FILTER (WHERE resolvido_por = 'usuario')::text AS horas_medias
     FROM agente_ads_observacoes
     GROUP BY tipo`
  );
  return rows.map((r) => ({
    tipo: r.tipo,
    total: Number(r.total),
    confirmadas: Number(r.confirmadas),
    resolvidasSozinhas: Number(r.resolvidas_sozinhas),
    horasMediasParaConfirmar: r.horas_medias ? Number(r.horas_medias) : null,
  }));
}

function formatarHistoricoReacao(historico: HistoricoReacaoTipo[]): string {
  if (historico.length === 0) return "Ainda sem histórico suficiente — é a primeira vez ou poucas observações até agora.";
  return historico
    .map((h) => {
      const partes = [`"${h.tipo}": ${h.total} observações registradas até hoje`];
      if (h.confirmadas > 0) {
        partes.push(
          `${h.confirmadas} confirmadas pelo dono` +
            (h.horasMediasParaConfirmar !== null ? ` (em média ${h.horasMediasParaConfirmar.toFixed(1)}h depois de aparecer)` : "")
        );
      }
      if (h.resolvidasSozinhas > 0) partes.push(`${h.resolvidasSozinhas} se resolveram sozinhas antes do dono agir`);
      return partes.join(", ");
    })
    .join("\n");
}

async function gerarObservacoesComIA(campanhas: CampanhaComTacos[], diasPeriodo: number): Promise<ObservacaoIA[] | null> {
  const client = obterClienteAnthropic();
  if (!client) return null;

  const ativas = campanhas.filter((c) => c.status === "active" && c.custo > 0);
  if (ativas.length === 0) return [];

  const linhas = construirLinhasCampanhas(ativas);
  const historico = formatarHistoricoReacao(await buscarHistoricoReacao());

  const resposta = await client.messages.create({
    model: MODELO_IA,
    max_tokens: 8000,
    // Thinking "adaptive" deixava a decisão de raciocinar (ou não) por conta
    // do modelo, e na prática ele escolheu 0 tokens de raciocínio nas
    // primeiras rodadas em produção — nada visível pro usuário. Em vez de
    // depender disso, pedimos texto normal de análise ANTES da ferramenta
    // (tool_choice "auto", não forçado) — instrução direta é bem mais
    // confiável que esperar o modelo "decidir" pensar em voz alta.
    system: `Você é um analista de tráfego pago (Mercado Ads) experiente, especializado num grupo de lojas de tinta e material de construção que vendem no Mercado Livre.

Você recebe os dados reais das campanhas ativas (com gasto) das lojas do grupo, no período dos últimos ${diasPeriodo} dias, e decide sozinho quais merecem atenção agora.

Regras:
- Só reporte campanhas que genuinamente precisam de atenção (prejuízo real, verba parada sem retorno, ou oportunidade clara de escalar) — campanhas indo bem não entram no relatório.
- "acos_ideal_margem_real" é o teto de ACOS que a margem real do produto aguenta — passar disso é prejuízo líquido, mesmo com venda.
- "tacos_real" bem abaixo do "acos_meta" sugere que a venda já aconteceria sem o anúncio (verba desperdiçada em venda orgânica).
- Seja específico: cite os números reais na explicação, não generalize.
- "contexto": 1-2 frases diretas. "acao": sugestão concreta e curta.
- Antes de usar a ferramenta, escreva um parágrafo curto em texto normal comparando as campanhas em voz alta e explicando por que cada uma entra ou não no relatório final — esse texto é mostrado pro dono do negócio depois, então pode ser natural e direto, como se estivesse explicando pra ele.
- Depois desse texto, sempre chame a ferramenta "reportar_observacoes" pra reportar formalmente — chame mesmo se a lista vier vazia (nenhuma campanha precisando de atenção agora).

Histórico de como o dono costuma reagir a cada tipo de observação (só pra te ajudar a escrever uma ação mais realista e decidir a ORDEM de prioridade — REGRA ABSOLUTA: isso NUNCA decide se uma campanha entra ou não no relatório. Mesmo que o histórico mostre que o dono quase nunca confirma um tipo, ou que ele geralmente não consegue agir, você reporta do mesmo jeito TODA campanha que realmente atende aos critérios objetivos acima. A informação tem que estar sempre visível pra ele, nunca escondida por causa de um padrão passado — ele pode não conseguir agir toda vez, mas precisa sempre saber):
${historico}`,
    messages: [
      {
        role: "user",
        content: `Campanhas ativas com gasto no período:\n\n${linhas}\n\nAnalise e reporte as que merecem atenção.`,
      },
    ],
    tools: [FERRAMENTA_OBSERVACOES],
    tool_choice: { type: "auto" },
  });

  console.log(`Agente de Ads (IA): ${resposta.usage.input_tokens} tokens de entrada, ${resposta.usage.output_tokens} de saída.`);

  const blocosTexto = resposta.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
  const pensamento = blocosTexto
    .map((b) => b.text)
    .filter((t) => t.trim().length > 0)
    .join("\n\n");
  if (pensamento) {
    await pool.query("INSERT INTO agente_ads_pensamentos (pensamento) VALUES ($1)", [pensamento]);
  }

  const blocoFerramenta = resposta.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!blocoFerramenta) {
    // Sem chamada de ferramenta não dá pra confiar que "não tem nada a
    // reportar" — melhor pular a rodada inteira (catch em verificarAgenteAds)
    // do que arriscar reportar uma lista vazia errada.
    throw new Error("IA respondeu só em texto, sem chamar a ferramenta de observações.");
  }

  const observacoesRaw = (blocoFerramenta.input as { observacoes?: unknown }).observacoes;
  // Normalmente vem como array, mas o modelo às vezes devolve um objeto com
  // chaves numéricas em vez de array de verdade — aceita os dois formatos em
  // vez de quebrar e cair pro fallback de regras fixas à toa.
  const lista: Array<{ loja_id: number; campanha_id: string; tipo: string; contexto: string; acao: string }> =
    Array.isArray(observacoesRaw)
      ? observacoesRaw
      : observacoesRaw && typeof observacoesRaw === "object"
        ? Object.values(observacoesRaw)
        : [];

  if (!Array.isArray(observacoesRaw)) {
    console.error("Agente de Ads (IA): 'observacoes' veio em formato inesperado, normalizando:", JSON.stringify(observacoesRaw));
  }

  return lista.map((o) => ({
    lojaId: o.loja_id,
    campanhaId: o.campanha_id,
    tipo: o.tipo,
    contexto: o.contexto,
    acao: o.acao,
  }));
}

const DIAS_JANELA = 7;

// Só as 4 contas PESSOAIS do usuário — não o grupo inteiro (16 lojas). IDs
// confirmados via GET /api/lojas/todas: Hangar=1, Catedral
// Impermeabilizantes=2, Inga Collors=3, Perpétua=4.
const LOJAS_AGENTE = [1, 2, 3, 4];

// Busca as campanhas das 4 lojas pessoais (ver LOJAS_AGENTE) com TACOS/lucro
// já calculados — reaproveitada pela verificação automática e pelo chat.
async function buscarCampanhasComTacos(): Promise<CampanhaComTacos[]> {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - (DIAS_JANELA - 1) * 24 * 60 * 60 * 1000);
  const dataInicio = dataISO(inicio);
  const dataFim = dataISO(hoje);

  const [campanhas, receitas] = await Promise.all([
    listarCampanhasAds(undefined, LOJAS_AGENTE, dataInicio, dataFim),
    listarReceitaRealPorCampanha(undefined, LOJAS_AGENTE, dataInicio, dataFim),
  ]);

  const receitaPorChave = new Map(receitas.map((r) => [`${r.lojaId}-${r.campanhaId}`, r]));

  return campanhas.map((c) => {
    const dados = receitaPorChave.get(`${c.lojaId}-${c.campanhaId}`);
    const receitaReal = dados?.receitaTotalReal ?? 0;
    const receitaBase = Math.max(receitaReal, c.vendasTotais);
    const tacosReal = receitaBase > 0 ? (c.custo / receitaBase) * 100 : null;
    const acosIdeal = dados?.acosIdeal ?? null;
    return { ...c, tacosReal, acosIdeal, lucroReais: calcularLucroReais({ custo: c.custo, receitaBase, acosIdeal }) };
  });
}

// Roda só pras 4 lojas pessoais (ver LOJAS_AGENTE) sobre os últimos 7 dias,
// mesma janela que a tela de Ads usa por padrão.
export async function verificarAgenteAds(): Promise<{ novas: number; resolvidasSozinhas: number }> {
  const campanhasComTacos = await buscarCampanhasComTacos();

  // Só a análise com IA de verdade — sem fallback de regras fixas. Se não
  // tiver ANTHROPIC_API_KEY configurada ou a chamada falhar por qualquer
  // motivo (API fora do ar, limite, etc.), a rodada é pulada por completo
  // em vez de reportar algo que não veio da IA.
  let observacoesIA: ObservacaoIA[];
  try {
    const resultado = await gerarObservacoesComIA(campanhasComTacos, DIAS_JANELA);
    if (resultado === null) {
      console.error("Agente de Ads: ANTHROPIC_API_KEY não configurada — rodada pulada.");
      return { novas: 0, resolvidasSozinhas: 0 };
    }
    observacoesIA = resultado;
  } catch (err) {
    console.error("Agente de Ads: falha na análise com IA, rodada pulada:", err);
    return { novas: 0, resolvidasSozinhas: 0 };
  }

  const obsPorChave = new Map<string, ObservacaoGerada>();
  for (const o of observacoesIA) {
    obsPorChave.set(`${o.lojaId}-${o.campanhaId}`, { tipo: o.tipo, contexto: o.contexto, acao: o.acao });
  }

  let novas = 0;
  const chavesDetectadasPorLoja = new Map<number, string[]>();

  for (const c of campanhasComTacos) {
    const chave = `${c.lojaId}-${c.campanhaId}`;
    const obs = obsPorChave.get(chave);
    if (!obs) continue;
    if (!chavesDetectadasPorLoja.has(c.lojaId)) chavesDetectadasPorLoja.set(c.lojaId, []);
    chavesDetectadasPorLoja.get(c.lojaId)!.push(chave);

    const { rowCount } = await pool.query(
      `INSERT INTO agente_ads_observacoes (loja_id, campanha_id, campanha_nome, chave, tipo, contexto, acao)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (chave) WHERE status = 'pendente' DO NOTHING`,
      [c.lojaId, String(c.campanhaId), c.nome, chave, obs.tipo, obs.contexto, obs.acao]
    );
    if (rowCount && rowCount > 0) novas++;
  }

  let resolvidasSozinhas = 0;
  for (const [lojaId, chaves] of chavesDetectadasPorLoja) {
    const { rowCount } = await pool.query(
      `UPDATE agente_ads_observacoes
       SET status = 'resolvida', resolvido_por = 'sistema', resolvido_em = now()
       WHERE loja_id = $1 AND status = 'pendente' AND chave != ALL($2::text[])`,
      [lojaId, chaves]
    );
    resolvidasSozinhas += rowCount ?? 0;
  }
  // Lojas sem nenhuma observação detectada nesta rodada não entram no mapa
  // acima — fecha as pendentes delas também (senão nunca seriam resolvidas).
  const lojaIdsComCampanha = new Set(campanhasComTacos.map((c) => c.lojaId));
  const lojaIdsSemDeteccao = [...lojaIdsComCampanha].filter((id) => !chavesDetectadasPorLoja.has(id));
  for (const lojaId of lojaIdsSemDeteccao) {
    const { rowCount } = await pool.query(
      `UPDATE agente_ads_observacoes
       SET status = 'resolvida', resolvido_por = 'sistema', resolvido_em = now()
       WHERE loja_id = $1 AND status = 'pendente'`,
      [lojaId]
    );
    resolvidasSozinhas += rowCount ?? 0;
  }

  return { novas, resolvidasSozinhas };
}

export interface ObservacaoAds {
  id: number;
  lojaId: number;
  campanhaId: string;
  campanhaNome: string;
  tipo: string;
  contexto: string;
  acao: string;
  status: string;
  resolvidoPor: string | null;
  criadoEm: string;
  resolvidoEm: string | null;
  lojaNome: string;
}

export async function listarObservacoes(status?: "pendente" | "resolvida"): Promise<ObservacaoAds[]> {
  const { rows } = await pool.query<{
    id: number;
    loja_id: number;
    campanha_id: string;
    campanha_nome: string;
    tipo: string;
    contexto: string;
    acao: string;
    status: string;
    resolvido_por: string | null;
    criado_em: string;
    resolvido_em: string | null;
    loja_nome: string;
  }>(
    `SELECT o.id, o.loja_id, o.campanha_id, o.campanha_nome, o.tipo, o.contexto, o.acao, o.status,
            o.resolvido_por, o.criado_em, o.resolvido_em, l.nome AS loja_nome
     FROM agente_ads_observacoes o
     JOIN lojas l ON l.id = o.loja_id
     WHERE o.loja_id = ANY($1::int[]) AND ($2::text IS NULL OR o.status = $2)
     ORDER BY (o.status = 'pendente') DESC, o.criado_em DESC
     LIMIT 200`,
    [LOJAS_AGENTE, status ?? null]
  );
  return rows.map((r) => ({
    id: r.id,
    lojaId: r.loja_id,
    campanhaId: r.campanha_id,
    campanhaNome: r.campanha_nome,
    tipo: r.tipo,
    contexto: r.contexto,
    acao: r.acao,
    status: r.status,
    resolvidoPor: r.resolvido_por,
    criadoEm: r.criado_em,
    resolvidoEm: r.resolvido_em,
    lojaNome: r.loja_nome,
  }));
}

export async function confirmarObservacao(id: number): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE agente_ads_observacoes SET status = 'resolvida', resolvido_por = 'usuario', resolvido_em = now()
     WHERE id = $1 AND status = 'pendente'`,
    [id]
  );
  if (!rowCount) {
    throw new Error("Observação não encontrada ou já resolvida.");
  }
}

export interface PensamentoAds {
  id: number;
  pensamento: string;
  criadoEm: string;
}

export async function listarPensamentos(limite = 20): Promise<PensamentoAds[]> {
  const { rows } = await pool.query<{ id: number; pensamento: string; criado_em: string }>(
    "SELECT id, pensamento, criado_em FROM agente_ads_pensamentos ORDER BY criado_em DESC LIMIT $1",
    [limite]
  );
  return rows.map((r) => ({ id: r.id, pensamento: r.pensamento, criadoEm: r.criado_em }));
}

export interface MensagemChat {
  papel: "usuario" | "agente";
  texto: string;
}

// Chat direto com o agente — pergunta livre do dono, respondida com os
// dados reais e atuais das campanhas das 4 lojas pessoais como contexto
// (buscados na hora, não reaproveita cache do feed automático).
export async function perguntarAgenteAds(pergunta: string, historico: MensagemChat[]): Promise<string> {
  const client = obterClienteAnthropic();
  if (!client) {
    throw new Error("IA não configurada neste ambiente (falta ANTHROPIC_API_KEY).");
  }

  const campanhasComTacos = await buscarCampanhasComTacos();
  const linhas = construirLinhasCampanhas(campanhasComTacos);

  const resposta = await client.messages.create({
    model: MODELO_IA,
    max_tokens: 2000,
    system: `Você é um analista de tráfego pago (Mercado Ads) experiente, especializado num grupo de lojas de tinta e material de construção que vendem no Mercado Livre. Está conversando direto com o dono do negócio sobre as campanhas de Ads das 4 lojas pessoais dele.

Responda com base nos dados reais abaixo, citando números quando fizer sentido. Seja direto e responda sempre em português.

Dados atuais das campanhas (últimos ${DIAS_JANELA} dias):

${linhas || "Nenhuma campanha encontrada no período."}`,
    messages: [
      ...historico.map((m) => ({
        role: (m.papel === "usuario" ? "user" : "assistant") as "user" | "assistant",
        content: m.texto,
      })),
      { role: "user", content: pergunta },
    ],
  });

  const texto = resposta.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");

  return texto || "Não consegui gerar uma resposta.";
}

const INTERVALO_MS = 4 * 60 * 60 * 1000; // 4h

export function iniciarVerificacaoAgenteAds(): void {
  async function verificar() {
    try {
      const resultado = await verificarAgenteAds();
      console.log(`Agente de Ads: ${resultado.novas} nova(s), ${resultado.resolvidasSozinhas} resolvida(s) sozinha(s).`);
    } catch (err) {
      console.error("Erro na verificação do agente de Ads:", err);
    }
  }
  verificar();
  setInterval(verificar, INTERVALO_MS);
}
