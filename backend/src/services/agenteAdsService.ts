import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { listarCampanhasAds, type CampanhaAds } from "./adsService";
import { listarReceitaRealPorCampanha } from "./tacosService";

const formatCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format;

// Mesmas regras de "Insights" de frontend/src/components/Ads.tsx (linhas
// ~48-264), portadas pro backend porque o agente precisa rodar sozinho em
// segundo plano (não só quando alguém abre a tela) e guardar histórico —
// contexto vira string em vez de ReactNode, o resto da lógica é igual.
// Usadas como FALLBACK quando não tem ANTHROPIC_API_KEY configurada (ex.:
// dev local) ou quando a chamada de IA falha — o agente nunca fica
// totalmente mudo por causa de uma indisponibilidade da API de IA.

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

const LIMIAR_ORCAMENTO_PARADO = 0.2;
const LIMIAR_TACOS_ORGANICO = 0.5;
const GASTO_MINIMO_SEM_VENDA = 20;

type Grupo = "semVenda" | "acimaMeta" | "orcamentoParado" | "dentroMeta" | null;

function grupoDaCampanha(c: CampanhaAds, diasPeriodo: number): Grupo {
  if (c.status !== "active" || c.custo === 0) return null;
  if (c.vendasTotais === 0) return "semVenda";
  if (c.acos > c.acosMeta) return "acimaMeta";
  if (c.orcamento > 0 && c.custo / (c.orcamento * diasPeriodo) < LIMIAR_ORCAMENTO_PARADO) return "orcamentoParado";
  return "dentroMeta";
}

type TipoInsight = "prejuizo" | "semVenda" | "margemSobra" | "orcamentoParado" | "organico";

const ACAO_POR_TIPO: Record<TipoInsight, string> = {
  prejuizo: "Cortar orçamento ou pausar agora",
  semVenda: "Pausar ou revisar o anúncio",
  margemSobra: "Considerar subir a meta de ACOS",
  orcamentoParado: "Aumentar orçamento — oportunidade de escalar",
  organico: "Testar reduzir investimento e comparar",
};

interface ObservacaoGerada {
  tipo: string;
  contexto: string;
  acao: string;
}

function gerarObservacao(c: CampanhaComTacos, diasPeriodo: number): ObservacaoGerada | null {
  const grupo = grupoDaCampanha(c, diasPeriodo);
  let tipo: TipoInsight | null = null;
  let contexto = "";

  if (c.acosIdeal !== null && c.vendasTotais > 0 && c.acos > c.acosIdeal) {
    tipo = "prejuizo";
    contexto = `ACOS em ${c.acos.toFixed(0)}%, acima até da margem real (${c.acosIdeal.toFixed(0)}%) — cada venda está dando prejuízo.`;
  } else if (grupo === "semVenda" && c.custo >= GASTO_MINIMO_SEM_VENDA) {
    tipo = "semVenda";
    contexto = `Gastou ${formatCurrency(c.custo)} em ${diasPeriodo} dia${diasPeriodo > 1 ? "s" : ""} sem nenhuma venda atribuída.`;
  } else if (grupo === "acimaMeta" && c.acosIdeal !== null && c.acosIdeal > c.acosMeta) {
    tipo = "margemSobra";
    contexto = `ACOS em ${c.acos.toFixed(0)}% vs meta de ${c.acosMeta.toFixed(0)}% — mas a margem real aguentaria até ${c.acosIdeal.toFixed(0)}%.`;
  } else if (grupo === "orcamentoParado") {
    const pctOrcamento = c.orcamento > 0 ? (c.custo / (c.orcamento * diasPeriodo)) * 100 : 0;
    tipo = "orcamentoParado";
    contexto = `Gastando só ${pctOrcamento.toFixed(0)}% do orçamento diário, com ACOS saudável de ${c.acos.toFixed(0)}%.`;
  } else if (
    c.tacosReal !== null &&
    c.acosMeta > 0 &&
    c.vendasTotais > 0 &&
    c.tacosReal < c.acosMeta * LIMIAR_TACOS_ORGANICO
  ) {
    tipo = "organico";
    contexto = `TACOS real de ${c.tacosReal.toFixed(0)}% vs ACOS configurado de ${c.acosMeta.toFixed(0)}% — a maior parte da venda parece já vir sem o anúncio.`;
  }

  if (tipo === null) return null;
  return { tipo, contexto, acao: ACAO_POR_TIPO[tipo] };
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

async function gerarObservacoesComIA(campanhas: CampanhaComTacos[], diasPeriodo: number): Promise<ObservacaoIA[] | null> {
  const client = obterClienteAnthropic();
  if (!client) return null;

  const ativas = campanhas.filter((c) => c.status === "active" && c.custo > 0);
  if (ativas.length === 0) return [];

  const linhas = ativas
    .map((c) =>
      [
        `loja_id=${c.lojaId}`,
        `campanha_id=${c.campanhaId}`,
        `loja="${c.lojaNome}"`,
        `campanha="${c.nome}"`,
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

  const resposta = await client.messages.create({
    model: MODELO_IA,
    max_tokens: 8000,
    // "adaptive" + display "summarized" pra deixar o raciocínio da IA
    // visível (em claude-sonnet-5 o padrão é "omitted", que não devolve
    // texto nenhum) — forçar a ferramenta é compatível com thinking
    // adaptativo (não é com o modo manual/extended). Ver
    // frontend/src/components/AgenciaAgentesIA.tsx pro feed que mostra isso.
    thinking: { type: "adaptive", display: "summarized" },
    system: `Você é um analista de tráfego pago (Mercado Ads) experiente, especializado num grupo de lojas de tinta e material de construção que vendem no Mercado Livre.

Você recebe os dados reais das campanhas ativas (com gasto) das lojas do grupo, no período dos últimos ${diasPeriodo} dias, e decide sozinho quais merecem atenção agora.

Regras:
- Só reporte campanhas que genuinamente precisam de atenção (prejuízo real, verba parada sem retorno, ou oportunidade clara de escalar) — campanhas indo bem não entram no relatório.
- "acos_ideal_margem_real" é o teto de ACOS que a margem real do produto aguenta — passar disso é prejuízo líquido, mesmo com venda.
- "tacos_real" bem abaixo do "acos_meta" sugere que a venda já aconteceria sem o anúncio (verba desperdiçada em venda orgânica).
- Seja específico: cite os números reais na explicação, não generalize.
- "contexto": 1-2 frases diretas. "acao": sugestão concreta e curta.
- Pense em voz alta, comparando as campanhas e explicando por que cada uma entra ou não no relatório final — esse raciocínio é mostrado pro dono do negócio depois, então pode ser natural e direto, como se estivesse explicando pra ele.`,
    messages: [
      {
        role: "user",
        content: `Campanhas ativas com gasto no período:\n\n${linhas}\n\nAnalise e reporte as que merecem atenção.`,
      },
    ],
    tools: [FERRAMENTA_OBSERVACOES],
    tool_choice: { type: "tool", name: "reportar_observacoes" },
  });

  console.log(
    `Agente de Ads (IA): ${resposta.usage.input_tokens} tokens de entrada, ${resposta.usage.output_tokens} de saída (${resposta.usage.output_tokens_details?.thinking_tokens ?? 0} de raciocínio).`
  );

  const blocosPensamento = resposta.content.filter((b): b is Anthropic.ThinkingBlock => b.type === "thinking");
  const pensamento = blocosPensamento
    .map((b) => b.thinking)
    .filter((t) => t.trim().length > 0)
    .join("\n\n");
  if (pensamento) {
    await pool.query("INSERT INTO agente_ads_pensamentos (pensamento) VALUES ($1)", [pensamento]);
  }

  const blocoFerramenta = resposta.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!blocoFerramenta) return [];

  const dados = blocoFerramenta.input as {
    observacoes: Array<{ loja_id: number; campanha_id: string; tipo: string; contexto: string; acao: string }>;
  };

  return dados.observacoes.map((o) => ({
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

// Roda só pras 4 lojas pessoais (ver LOJAS_AGENTE) sobre os últimos 7 dias,
// mesma janela que a tela de Ads usa por padrão.
export async function verificarAgenteAds(): Promise<{ novas: number; resolvidasSozinhas: number }> {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - (DIAS_JANELA - 1) * 24 * 60 * 60 * 1000);
  const dataInicio = dataISO(inicio);
  const dataFim = dataISO(hoje);

  const [campanhas, receitas] = await Promise.all([
    listarCampanhasAds(undefined, LOJAS_AGENTE, dataInicio, dataFim),
    listarReceitaRealPorCampanha(undefined, LOJAS_AGENTE, dataInicio, dataFim),
  ]);

  const receitaPorChave = new Map(receitas.map((r) => [`${r.lojaId}-${r.campanhaId}`, r]));

  const campanhasComTacos: CampanhaComTacos[] = campanhas.map((c) => {
    const dados = receitaPorChave.get(`${c.lojaId}-${c.campanhaId}`);
    const receitaReal = dados?.receitaTotalReal ?? 0;
    const receitaBase = Math.max(receitaReal, c.vendasTotais);
    const tacosReal = receitaBase > 0 ? (c.custo / receitaBase) * 100 : null;
    const acosIdeal = dados?.acosIdeal ?? null;
    return { ...c, tacosReal, acosIdeal, lucroReais: calcularLucroReais({ custo: c.custo, receitaBase, acosIdeal }) };
  });

  // Tenta a análise com IA de verdade primeiro; sem chave configurada
  // (obterClienteAnthropic devolve null) ou se a chamada falhar por
  // qualquer motivo (API fora do ar, limite, etc.), cai pras regras fixas
  // — o agente nunca fica mudo por causa de uma indisponibilidade externa.
  let obsPorChave = new Map<string, ObservacaoGerada>();
  try {
    const observacoesIA = await gerarObservacoesComIA(campanhasComTacos, DIAS_JANELA);
    if (observacoesIA !== null) {
      for (const o of observacoesIA) {
        obsPorChave.set(`${o.lojaId}-${o.campanhaId}`, { tipo: o.tipo, contexto: o.contexto, acao: o.acao });
      }
    } else {
      for (const c of campanhasComTacos) {
        const obs = gerarObservacao(c, DIAS_JANELA);
        if (obs) obsPorChave.set(`${c.lojaId}-${c.campanhaId}`, obs);
      }
    }
  } catch (err) {
    console.error("Agente de Ads: falha na análise com IA, usando regras fixas:", err);
    obsPorChave = new Map();
    for (const c of campanhasComTacos) {
      const obs = gerarObservacao(c, DIAS_JANELA);
      if (obs) obsPorChave.set(`${c.lojaId}-${c.campanhaId}`, obs);
    }
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
     WHERE $1::text IS NULL OR o.status = $1
     ORDER BY (o.status = 'pendente') DESC, o.criado_em DESC
     LIMIT 200`,
    [status ?? null]
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
