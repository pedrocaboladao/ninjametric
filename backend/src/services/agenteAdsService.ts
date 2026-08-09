import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { listarCampanhasAds, type CampanhaAds } from "./adsService";
import { listarReceitaRealPorCampanha } from "./tacosService";
import { agendarPorHorario, dataISOBR } from "./dateUtils";

const formatCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format;

export interface CampanhaComTacos extends CampanhaAds {
  tacosReal: number | null;
  acosIdeal: number | null;
  lucroReais: number | null;
}

// Lucro real = margem de contribuição real (R$, mesmo cálculo do
// Financeiro) menos o gasto de Ads — direto, sem reaplicar a margem em %
// sobre outra base de receita (isso introduzia um pequeno erro sempre que
// vendasTotais do Ads divergia da receita real cruzada com o Financeiro).
// Sem margemReal (produto sem custo cadastrado, ou campanha sem venda
// cruzada) não dá pra julgar.
function calcularLucroReal(c: { custo: number; margemReal: number | null }): number | null {
  if (c.margemReal === null) return null;
  return c.margemReal - c.custo;
}

function descricaoJanela(diasPeriodo: number): string {
  return diasPeriodo === 1 ? "de hoje" : `dos últimos ${diasPeriodo} dias`;
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
export function construirLinhasCampanhas(campanhas: CampanhaComTacos[]): string {
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
  if (ativas.length === 0) {
    // Grava mesmo sem nada a analisar — sem isso, uma loja sem campanha
    // ativa com gasto simplesmente não aparece na rodada, e não dá pra
    // distinguir "não tinha nada a dizer" de "a checagem falhou" só olhando
    // o feed.
    await pool.query("INSERT INTO agente_ads_pensamentos (pensamento, loja_id, janela) VALUES ($1, $2, $3)", [
      `Nenhuma campanha ativa com gasto no período ${descricaoJanela(diasPeriodo)} — nada a analisar por aqui agora.`,
      lojaId,
      janela,
    ]);
    return;
  }

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

export const DIAS_JANELA = 7;

// Só as 4 contas PESSOAIS do usuário — não o grupo inteiro (16 lojas). IDs
// confirmados via GET /api/lojas/todas: Hangar=1, Catedral
// Impermeabilizantes=2, Inga Collors=3, Perpétua=4.
const LOJAS_AGENTE = [1, 2, 3, 4];

// Busca as campanhas das 4 lojas pessoais (ver LOJAS_AGENTE) com TACOS/lucro
// já calculados — reaproveitada pela verificação automática (janela de 7
// dias e a diária de hoje), pelo chat, e pelo resumo do escritório do Modo
// TV (ver resumoEscritorioService.ts, "lucro do Ads hoje"). "lojaId"
// opcional restringe a busca a uma única loja (usado pela verificação, que
// analisa loja por loja).
export async function buscarCampanhasComTacos(diasPeriodo: number, lojaId?: number): Promise<CampanhaComTacos[]> {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - (diasPeriodo - 1) * 24 * 60 * 60 * 1000);
  const dataInicio = dataISOBR(inicio);
  const dataFim = dataISOBR(hoje);

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
    const margemReal = dados?.margemReal ?? null;
    return { ...c, tacosReal, acosIdeal, lucroReais: calcularLucroReal({ custo: c.custo, margemReal }) };
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

  // Busca + análise POR LOJA, em vez de uma chamada só com as campanhas das
  // 4 juntas — com tudo misturado no mesmo prompt a atenção da IA se dilui
  // entre as contas; separada por loja, cada uma recebe uma análise
  // dedicada, sem competir por espaço com as campanhas das outras 3. Busca
  // e análise ficam dentro do MESMO try — se uma loja falhar (token
  // vencido, API fora do ar, erro pontual), só ela é pulada nessa rodada,
  // as outras 3 seguem normalmente (antes só a chamada de IA tinha esse
  // isolamento; a busca dos dados podia derrubar a rodada inteira).
  let lojasAnalisadas = 0;
  let falhas = 0;
  for (const lojaId of LOJAS_AGENTE) {
    try {
      const campanhasDaLoja = await buscarCampanhasComTacos(diasPeriodo, lojaId);
      await gerarAnaliseIA(campanhasDaLoja, diasPeriodo, lojaId, janela);
      lojasAnalisadas++;
    } catch (err) {
      console.error(`Agente de Ads (${janela}, loja ${lojaId}): falha na checagem, loja pulada nessa rodada:`, err);
      falhas++;
      // Também registra no feed, não só no console do servidor — senão a
      // única forma de notar uma falha é reparar que uma loja "sumiu" do
      // feed sem nenhuma explicação visível.
      await pool
        .query("INSERT INTO agente_ads_pensamentos (pensamento, loja_id, janela) VALUES ($1, $2, $3)", [
          "Não consegui checar essa loja nessa rodada (falha ao buscar os dados ou ao analisar) — tento de novo na próxima checagem.",
          lojaId,
          janela,
        ])
        .catch((erroInsert) => console.error(`Agente de Ads (${janela}, loja ${lojaId}): falha ao registrar o aviso de erro:`, erroInsert));
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

// "limitePorLoja" (não total) — com 4 lojas gerando pensamento a cada
// rodada (mesmo sem achado, ver executarVerificacao), um limite só no total
// deixava a loja que roda primeiro no loop (Hangar, LOJAS_AGENTE[0]) cair
// fora da janela visível conforme as outras 3 acumulavam registros mais
// recentes no mesmo dia — mesmo com dado gravado certinho no banco.
export async function listarPensamentos(limitePorLoja = 10): Promise<PensamentoAds[]> {
  const { rows } = await pool.query<{
    id: number;
    pensamento: string;
    criado_em: string;
    loja_id: number | null;
    loja_nome: string | null;
    janela: string;
  }>(
    `SELECT id, pensamento, criado_em, loja_id, loja_nome, janela
     FROM (
       SELECT p.id, p.pensamento, p.criado_em, p.loja_id, l.nome AS loja_nome, p.janela,
              ROW_NUMBER() OVER (PARTITION BY p.loja_id ORDER BY p.criado_em DESC) AS posicao
       FROM agente_ads_pensamentos p
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
    janela: r.janela,
  }));
}

// Janela de 7 dias muda pouco de uma checagem pra outra no mesmo dia (só
// ~6h de dado novo dentro de 168h de janela) — 1x/dia já captura a
// tendência sem repetir análise quase igual 3x. Roda antes do Plano do Dia
// (8h) de propósito, pra ele já ter esse contexto semanal fresco.
const HORARIOS_7DIAS = [7]; // horário de Brasília — 1x/dia
const HORARIOS_DIARIOS = [9, 14, 21]; // horário de Brasília — 3x/dia (aqui sim o dia muda de verdade a cada checagem)

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
