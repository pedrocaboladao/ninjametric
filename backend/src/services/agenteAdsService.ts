import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { listarCampanhasAds, type CampanhaAds } from "./adsService";
import { listarReceitaRealPorCampanha } from "./tacosService";
import { chaveJanelaDoDia } from "./dateUtils";

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

function descricaoJanela(diasPeriodo: number): string {
  return diasPeriodo === 1 ? "de hoje" : `dos últimos ${diasPeriodo} dias`;
}

function dataISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Análise real com IA (Claude) — só reporta em texto corrido (sem cards por
// campanha, sem fila de "confirmar/resolver"), pedido explícito do dono:
// prefere ler um parágrafo comparando as campanhas de uma vez a ficar
// clicando card por card.
const MODELO_IA = "claude-sonnet-5";

let clienteAnthropic: Anthropic | null | undefined;
function obterClienteAnthropic(): Anthropic | null {
  if (clienteAnthropic === undefined) {
    clienteAnthropic = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;
  }
  return clienteAnthropic;
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

// Pede a análise em texto corrido de todas as campanhas ativas com gasto de
// uma loja, e já grava como "pensamento" — não existe mais observação
// estruturada por campanha (nem fila de pendente/resolvido).
async function gerarAnaliseIA(campanhas: CampanhaComTacos[], diasPeriodo: number, lojaId: number, janela: string): Promise<void> {
  const client = obterClienteAnthropic();
  if (!client) return;

  const ativas = campanhas.filter((c) => c.status === "active" && c.custo > 0);
  if (ativas.length === 0) return;

  const linhas = construirLinhasCampanhas(ativas);

  const resposta = await client.messages.create({
    model: MODELO_IA,
    max_tokens: 2000,
    system: `Você é um analista de tráfego pago (Mercado Ads) experiente, especializado num grupo de lojas de tinta e material de construção que vendem no Mercado Livre.

Você recebe os dados reais das campanhas ativas (com gasto) de uma loja, no período ${descricaoJanela(diasPeriodo)}, e escreve uma análise corrida pro dono do negócio ler — não é um relatório formal, é você comparando as campanhas em voz alta, como se estivesse sentado do lado dele.

Regras:
- "acos_ideal_margem_real" é o teto de ACOS que a margem real do produto aguenta — passar disso é prejuízo líquido, mesmo com venda.
- "tacos_real" bem abaixo do "acos_meta" sugere que a venda já aconteceria sem o anúncio (verba desperdiçada em venda orgânica).
- Separe o que é ruído (gasto pequeno, sem tração, irrelevante financeiramente) do que é sinal real.
- Priorize: primeiro o que precisa de ação urgente (prejuízo real, verba parada sem retorno), depois oportunidades claras de escalar, depois o que só merece um olhar, e feche mencionando rapidamente o que está saudável.
- Cite os números reais — não generalize.
- Texto direto, sem introdução nem despedida. Só o parágrafo(s) da análise.`,
    messages: [
      {
        role: "user",
        content: `Campanhas ativas com gasto no período ${descricaoJanela(diasPeriodo)}:\n\n${linhas}\n\nAnalise.`,
      },
    ],
  });

  console.log(`Agente de Ads (IA): ${resposta.usage.input_tokens} tokens de entrada, ${resposta.usage.output_tokens} de saída.`);

  const pensamento = resposta.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .filter((t) => t.trim().length > 0)
    .join("\n\n");

  if (pensamento) {
    await pool.query("INSERT INTO agente_ads_pensamentos (pensamento, loja_id, janela) VALUES ($1, $2, $3)", [
      pensamento,
      lojaId,
      janela,
    ]);
  }
}

const DIAS_JANELA = 7;

// Só as 4 contas PESSOAIS do usuário — não o grupo inteiro (16 lojas). IDs
// confirmados via GET /api/lojas/todas: Hangar=1, Catedral
// Impermeabilizantes=2, Inga Collors=3, Perpétua=4.
const LOJAS_AGENTE = [1, 2, 3, 4];

// Busca as campanhas das 4 lojas pessoais (ver LOJAS_AGENTE) com TACOS/lucro
// já calculados — reaproveitada pela verificação automática (janela de 7
// dias e a diária de hoje) e pelo chat. "lojaId" opcional restringe a busca
// a uma única loja (usado pela verificação, que analisa loja por loja).
async function buscarCampanhasComTacos(diasPeriodo: number, lojaId?: number): Promise<CampanhaComTacos[]> {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - (diasPeriodo - 1) * 24 * 60 * 60 * 1000);
  const dataInicio = dataISO(inicio);
  const dataFim = dataISO(hoje);

  const [campanhas, receitas] = await Promise.all([
    listarCampanhasAds(lojaId, LOJAS_AGENTE, dataInicio, dataFim),
    listarReceitaRealPorCampanha(lojaId, LOJAS_AGENTE, dataInicio, dataFim),
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

// Núcleo comum das duas verificações (7 dias e diária) — só muda a janela de
// dados analisada e o rótulo salvo em "janela" (mostrado no feed).
async function executarVerificacao(diasPeriodo: number, janela: string): Promise<{ lojas: number; falhas: number }> {
  // Sem chave, nem vale buscar as campanhas — pula a rodada inteira de uma
  // vez em vez de repetir o mesmo aviso 4x (uma por loja).
  if (!obterClienteAnthropic()) {
    console.error(`Agente de Ads (${janela}): ANTHROPIC_API_KEY não configurada — rodada pulada.`);
    return { lojas: 0, falhas: 0 };
  }

  // Uma chamada de IA POR LOJA, em vez de uma chamada só com as campanhas
  // das 4 juntas — com tudo misturado no mesmo prompt a atenção da IA se
  // dilui entre as contas; separada por loja, cada uma recebe uma análise
  // dedicada, sem competir por espaço com as campanhas das outras 3. Se uma
  // loja falhar (API fora do ar, erro pontual), só ela é pulada nessa
  // rodada — as outras 3 seguem normalmente.
  let lojasAnalisadas = 0;
  let falhas = 0;
  for (const lojaId of LOJAS_AGENTE) {
    const campanhasDaLoja = await buscarCampanhasComTacos(diasPeriodo, lojaId);
    try {
      await gerarAnaliseIA(campanhasDaLoja, diasPeriodo, lojaId, janela);
      lojasAnalisadas++;
    } catch (err) {
      console.error(`Agente de Ads (${janela}, loja ${lojaId}): falha na análise com IA, loja pulada nessa rodada:`, err);
      falhas++;
    }
  }

  return { lojas: lojasAnalisadas, falhas };
}

// Roda só pras 4 lojas pessoais (ver LOJAS_AGENTE) sobre os últimos 7 dias,
// mesma janela que a tela de Ads usa por padrão.
export async function verificarAgenteAds(): Promise<{ lojas: number; falhas: number }> {
  return executarVerificacao(DIAS_JANELA, "7dias");
}

// Segunda checagem, só do dia de hoje — pega uma campanha que começou a
// sangrar dinheiro hoje mesmo quando a média de 7 dias ainda parece
// saudável. Mesma tabela/feed, só um "janela" diferente.
export async function verificarAgenteAdsDiario(): Promise<{ lojas: number; falhas: number }> {
  return executarVerificacao(1, "hoje");
}

export interface PensamentoAds {
  id: number;
  pensamento: string;
  criadoEm: string;
  lojaId: number | null;
  lojaNome: string | null;
  janela: string;
}

export async function listarPensamentos(limite = 20): Promise<PensamentoAds[]> {
  const { rows } = await pool.query<{
    id: number;
    pensamento: string;
    criado_em: string;
    loja_id: number | null;
    loja_nome: string | null;
    janela: string;
  }>(
    `SELECT p.id, p.pensamento, p.criado_em, p.loja_id, l.nome AS loja_nome, p.janela
     FROM agente_ads_pensamentos p
     LEFT JOIN lojas l ON l.id = p.loja_id
     ORDER BY p.criado_em DESC
     LIMIT $1`,
    [limite]
  );
  return rows.map((r) => ({
    id: r.id,
    pensamento: r.pensamento,
    criadoEm: r.criado_em,
    lojaId: r.loja_id,
    lojaNome: r.loja_nome,
    janela: r.janela,
  }));
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

  const campanhasComTacos = await buscarCampanhasComTacos(DIAS_JANELA);
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

const HORARIOS_7DIAS = [7, 13, 19]; // horário de Brasília — 3x/dia
const HORARIOS_DIARIOS = [9, 14, 21]; // horário de Brasília — 3x/dia
const INTERVALO_CHECAGEM_HORARIO_MS = 5 * 60 * 1000; // 5min

// Dispara "acao" uma única vez por horário-âncora cruzado (ver
// HORARIOS_7DIAS/HORARIOS_DIARIOS), reaproveitando a mesma técnica de
// "janela por horário-âncora" do prewarm de promoções (chaveJanelaDoDia,
// dateUtils.ts) — a chave só muda quando o relógio cruza uma das horas,
// então checar a cada 5min dispara exatamente uma vez por âncora, não uma
// vez por checagem. Começa já sincronizado com a janela atual (em vez de
// null) pra não disparar uma rodada extra a cada reinício/deploy.
function agendarPorHorario(horarios: number[], acao: () => Promise<void>): void {
  let ultimaJanela = chaveJanelaDoDia(horarios);
  async function checar() {
    const janela = chaveJanelaDoDia(horarios);
    if (janela === ultimaJanela) return;
    ultimaJanela = janela;
    await acao();
  }
  setInterval(checar, INTERVALO_CHECAGEM_HORARIO_MS);
}

export function iniciarVerificacaoAgenteAds(): void {
  agendarPorHorario(HORARIOS_7DIAS, async () => {
    try {
      const resultado = await verificarAgenteAds();
      console.log(`Agente de Ads (7dias): ${resultado.lojas} loja(s) analisada(s), ${resultado.falhas} falha(s).`);
    } catch (err) {
      console.error("Erro na verificação do agente de Ads (7dias):", err);
    }
  });

  agendarPorHorario(HORARIOS_DIARIOS, async () => {
    try {
      const resultado = await verificarAgenteAdsDiario();
      console.log(`Agente de Ads (hoje): ${resultado.lojas} loja(s) analisada(s), ${resultado.falhas} falha(s).`);
    } catch (err) {
      console.error("Erro na verificação do agente de Ads (hoje):", err);
    }
  });
}
