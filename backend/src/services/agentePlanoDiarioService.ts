import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { listarOportunidades } from "./agenteOportunidadesService";
import { chaveJanelaDoDia, janelaHoje } from "./dateUtils";

const MODELO_IA = "claude-sonnet-5";

let clienteAnthropic: Anthropic | null | undefined;
function obterClienteAnthropic(): Anthropic | null {
  if (clienteAnthropic === undefined) {
    clienteAnthropic = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;
  }
  return clienteAnthropic;
}

interface EntradaAgente {
  agente: string;
  lojaNome: string | null;
  texto: string;
}

// Últimas 24h de cada tabela de pensamento — já são resumos por loja feitos
// pelos outros agentes, não dado bruto, então não precisa filtrar por
// LOJAS_AGENTE de novo (essas tabelas só recebem registro das 4 lojas
// pessoais mesmo).
async function buscarPensamentosDasUltimas24h(tabela: string, agente: string): Promise<EntradaAgente[]> {
  const { rows } = await pool.query<{ pensamento: string; loja_nome: string | null }>(
    `SELECT p.pensamento, l.nome AS loja_nome
     FROM ${tabela} p
     LEFT JOIN lojas l ON l.id = p.loja_id
     WHERE p.criado_em > now() - interval '24 hours'
     ORDER BY p.criado_em ASC`
  );
  return rows.map((r) => ({ agente, lojaNome: r.loja_nome, texto: r.pensamento }));
}

function construirTextoEntradas(entradas: EntradaAgente[]): string {
  return entradas.map((e) => `[${e.agente}${e.lojaNome ? ` · ${e.lojaNome}` : ""}]\n${e.texto}`).join("\n\n");
}

const FERRAMENTA_ITENS: Anthropic.Tool = {
  name: "listar_itens_do_plano",
  description: "Lista os itens de ação concretos e marcáveis do plano do dia, extraídos da análise.",
  input_schema: {
    type: "object",
    properties: {
      itens: {
        type: "array",
        description: "Uma ação curta e concreta por item, ordenada por prioridade (mais urgente primeiro).",
        items: { type: "string" },
      },
    },
    required: ["itens"],
  },
};

async function inserirPensamentoComItens(pensamento: string, itens: string[]): Promise<void> {
  const { rows } = await pool.query<{ id: number }>(
    "INSERT INTO agente_plano_diario (pensamento) VALUES ($1) RETURNING id",
    [pensamento]
  );
  const planoId = rows[0].id;
  for (const descricao of itens) {
    await pool.query("INSERT INTO agente_plano_diario_itens (plano_id, descricao) VALUES ($1, $2)", [
      planoId,
      descricao,
    ]);
  }
}

// Gerado 1x/dia (10h) — cruza os últimos 24h dos outros 4 agentes numa
// chamada só (ver conversa sobre diluição: a entrada já vem resumida por
// loja pelos outros agentes, não é dado bruto, então uma chamada só não
// dilui a atenção como diluiria analisando número cru de 4 lojas juntas).
async function gerarPlanoDiarioIA(): Promise<void> {
  const client = obterClienteAnthropic();
  if (!client) return;

  const [ads, conversao, catalogo, oportunidades] = await Promise.all([
    buscarPensamentosDasUltimas24h("agente_ads_pensamentos", "Ads"),
    buscarPensamentosDasUltimas24h("agente_conversao_pensamentos", "Conversão"),
    buscarPensamentosDasUltimas24h("agente_catalogo_pensamentos", "Catálogo"),
    listarOportunidades(),
  ]);

  const entradas = [...ads, ...conversao, ...catalogo];

  if (entradas.length === 0 && oportunidades.length === 0) {
    await inserirPensamentoComItens(
      "Nenhum agente registrou nada nas últimas 24h — sem material suficiente pra montar um plano do dia agora.",
      []
    );
    return;
  }

  const textoAgentes = construirTextoEntradas(entradas) || "(nenhum registro de Ads/Conversão/Catálogo nas últimas 24h)";
  const textoOportunidades =
    oportunidades.length > 0
      ? oportunidades.map((o) => `[Oportunidades] SKU ${o.sku} — "${o.titulo}": ${o.contexto}`).join("\n\n")
      : "(nenhuma oportunidade em aberto agora)";

  const resposta = await client.messages.create({
    model: MODELO_IA,
    max_tokens: 2000,
    system: `Você é um consultor de operações experiente, especializado num grupo de lojas de tinta e material de construção que vendem no Mercado Livre. O dono acompanha 4 lojas pessoais (Hangar, Catedral Impermeabilizantes, Inga Collors, Perpétua).

Você recebe tudo que os agentes especializados (Analista de Ads, Agente de Conversão, Agente de Catálogo, Agente de Oportunidades) registraram nas últimas 24h, já analisado e resumido por loja, e monta o PLANO DO DIA do dono — cruzando as 4 lojas, não uma por vez.

Regras:
- Priorize entre TUDO que recebeu, comparando urgência e tamanho real do impacto — não é só listar tudo em ordem, é decidir o que realmente vale a atenção do dono hoje primeiro.
- Corte repetição: se dois agentes falaram do mesmo problema (ex: o mesmo anúncio aparece em Ads e Conversão), junte num ponto só.
- Ignore o que já parece resolvido ou for só ruído (valores pequenos, sem impacto real).
- Diga sempre de qual loja é cada ponto.
- Cite números reais quando disponíveis — não generalize.
- Primeiro escreva o texto corrido normal explicando o raciocínio (sem introdução nem despedida). Depois, sempre chame a ferramenta "listar_itens_do_plano" com os mesmos pontos como itens curtos e concretos, um por ação — é isso que vira checklist marcável pro dono. Chame a ferramenta mesmo que a lista venha vazia.`,
    messages: [
      {
        role: "user",
        content: `Registros dos agentes nas últimas 24h:\n\n${textoAgentes}\n\nOportunidades em aberto agora:\n\n${textoOportunidades}\n\nMonte o plano do dia.`,
      },
    ],
    tools: [FERRAMENTA_ITENS],
    tool_choice: { type: "auto" },
  });

  console.log(`Agente de Plano do Dia (IA): ${resposta.usage.input_tokens} tokens de entrada, ${resposta.usage.output_tokens} de saída.`);

  const pensamento = resposta.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .filter((t) => t.trim().length > 0)
    .join("\n\n");

  const blocoFerramenta = resposta.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const itensRaw = blocoFerramenta ? (blocoFerramenta.input as { itens?: unknown }).itens : undefined;
  const itens: string[] = Array.isArray(itensRaw) ? itensRaw.filter((i): i is string => typeof i === "string") : [];

  if (pensamento) {
    await inserirPensamentoComItens(pensamento, itens);
  }
}

// Rodado às 18h — não gera plano novo, só cobra o que ficou pendente do
// plano de hoje (itens do agente_plano_diario_itens ainda não marcados).
// Não cria itens próprios (reaproveita os do plano da manhã, pra marcar um
// item não precisar decidir "em qual das duas entradas").
async function gerarCobrancaIA(): Promise<void> {
  const client = obterClienteAnthropic();
  if (!client) return;

  const hoje = janelaHoje();
  const { rows: pendentes } = await pool.query<{ descricao: string }>(
    `SELECT i.descricao
     FROM agente_plano_diario_itens i
     JOIN agente_plano_diario p ON p.id = i.plano_id
     WHERE p.criado_em >= $1 AND i.concluido = false
     ORDER BY i.id ASC`,
    [hoje.inicioDia]
  );

  if (pendentes.length === 0) {
    await pool.query("INSERT INTO agente_plano_diario (pensamento) VALUES ($1)", [
      "Cobrança das 18h: sem pendência — tudo que estava no plano de hoje já foi marcado como feito (ou não havia plano hoje).",
    ]);
    return;
  }

  const listaPendentes = pendentes.map((p) => `- ${p.descricao}`).join("\n");

  const resposta = await client.messages.create({
    model: MODELO_IA,
    max_tokens: 800,
    system: `Você é um consultor de operações direto, especializado num grupo de lojas de tinta e material de construção que vendem no Mercado Livre. São 18h e você está cobrando o dono sobre o plano do dia dele, que ainda tem itens pendentes.

Regras:
- Seja direto e breve — não repita a explicação de cada item, só cobre.
- Pode citar quantos itens faltam e nomear os mais importantes.
- Tom de "olha, ainda dá tempo hoje", não de bronca.
- Texto direto, sem introdução nem despedida.`,
    messages: [
      {
        role: "user",
        content: `Itens do plano de hoje ainda não marcados como feitos:\n\n${listaPendentes}\n\nEscreva a cobrança das 18h.`,
      },
    ],
  });

  const texto = resposta.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");

  if (texto) {
    await pool.query("INSERT INTO agente_plano_diario (pensamento) VALUES ($1)", [texto]);
  }
}

async function rodar(nome: string, fn: () => Promise<void>): Promise<void> {
  if (!obterClienteAnthropic()) {
    console.error(`Agente de Plano do Dia (${nome}): ANTHROPIC_API_KEY não configurada — rodada pulada.`);
    return;
  }
  try {
    await fn();
    console.log(`Agente de Plano do Dia (${nome}): rodada concluída.`);
  } catch (err) {
    console.error(`Agente de Plano do Dia (${nome}): falha na rodada:`, err);
    await pool
      .query("INSERT INTO agente_plano_diario (pensamento) VALUES ($1)", [
        `Não consegui rodar a checagem das ${nome} agora (falha ao buscar os dados ou ao analisar) — tento de novo na próxima janela.`,
      ])
      .catch((erroInsert) => console.error("Agente de Plano do Dia: falha ao registrar o aviso de erro:", erroInsert));
  }
}

export interface ItemPlanoDiario {
  id: number;
  descricao: string;
  concluido: boolean;
  concluidoEm: string | null;
}

export interface PlanoDiario {
  id: number;
  pensamento: string;
  criadoEm: string;
  itens: ItemPlanoDiario[];
}

export async function listarPlanoDiario(limite = 10): Promise<PlanoDiario[]> {
  const { rows: planos } = await pool.query<{ id: number; pensamento: string; criado_em: string }>(
    "SELECT id, pensamento, criado_em FROM agente_plano_diario ORDER BY criado_em DESC LIMIT $1",
    [limite]
  );
  if (planos.length === 0) return [];

  const { rows: itens } = await pool.query<{
    id: number;
    plano_id: number;
    descricao: string;
    concluido: boolean;
    concluido_em: string | null;
  }>(
    `SELECT id, plano_id, descricao, concluido, concluido_em
     FROM agente_plano_diario_itens
     WHERE plano_id = ANY($1::int[])
     ORDER BY id ASC`,
    [planos.map((p) => p.id)]
  );

  const itensPorPlano = new Map<number, ItemPlanoDiario[]>();
  for (const i of itens) {
    if (!itensPorPlano.has(i.plano_id)) itensPorPlano.set(i.plano_id, []);
    itensPorPlano.get(i.plano_id)!.push({
      id: i.id,
      descricao: i.descricao,
      concluido: i.concluido,
      concluidoEm: i.concluido_em,
    });
  }

  return planos.map((p) => ({
    id: p.id,
    pensamento: p.pensamento,
    criadoEm: p.criado_em,
    itens: itensPorPlano.get(p.id) ?? [],
  }));
}

export async function marcarItemPlano(id: number, concluido: boolean): Promise<void> {
  const { rowCount } = await pool.query(
    "UPDATE agente_plano_diario_itens SET concluido = $1, concluido_em = CASE WHEN $1 THEN now() ELSE NULL END WHERE id = $2",
    [concluido, id]
  );
  if (!rowCount) {
    throw new Error("Item do plano não encontrado.");
  }
}

const HORARIO_PLANO = [10]; // horário de Brasília — gera o plano do dia
const HORARIO_COBRANCA = [18]; // horário de Brasília — cobra pendências do dia
const INTERVALO_CHECAGEM_HORARIO_MS = 5 * 60 * 1000; // 5min

function agendarPorHorario(horarios: number[], acao: () => Promise<void>): void {
  let ultimaJanela = chaveJanelaDoDia(horarios);
  setInterval(async () => {
    const janela = chaveJanelaDoDia(horarios);
    if (janela === ultimaJanela) return;
    ultimaJanela = janela;
    await acao();
  }, INTERVALO_CHECAGEM_HORARIO_MS);
}

export function iniciarVerificacaoPlanoDiario(): void {
  agendarPorHorario(HORARIO_PLANO, () => rodar("plano do dia", gerarPlanoDiarioIA));
  agendarPorHorario(HORARIO_COBRANCA, () => rodar("cobrança 18h", gerarCobrancaIA));
}
