import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { listLojas, type Loja } from "./tokenStore";
import { listarItensAtivos, getItemsBasicInfo, getVisitasItem, searchOrders } from "./mercadoLivreApi";
import { janelaUltimosDias, chaveJanelaDoDia } from "./dateUtils";

// Só as 4 contas PESSOAIS do usuário — mesmo escopo dos outros agentes.
const LOJAS_AGENTE = [1, 2, 3, 4];
const DIAS_JANELA = 30;
// Abaixo disso o número de visitas é baixo demais pra taxa de conversão
// significar alguma coisa (1 venda em 3 visitas não é "33% de conversão"
// de verdade, é ruído estatístico) — ignora da análise.
const MIN_VISITAS = 20;

const STATUS_VALIDOS = new Set(["paid", "confirmed"]);

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

interface ItemConversao {
  itemId: string;
  titulo: string;
  visitas: number;
  vendas: number;
  conversao: number;
}

// Visitas por anúncio só aceita 1 item por chamada com data (ver
// getVisitasItem em mercadoLivreApi.ts) — daí a concorrência limitada em vez
// de uma chamada em lote.
async function coletarConversaoDaLoja(loja: Loja): Promise<ItemConversao[]> {
  const itemIds = await listarItensAtivos(loja.id, loja.ml_user_id as number);
  const itens = await getItemsBasicInfo(loja.id, itemIds);

  const janela = janelaUltimosDias(DIAS_JANELA);
  const dataInicio = janela.inicioDia.slice(0, 10);
  const dataFim = janela.agora.slice(0, 10);

  const orders = await searchOrders(loja.id, loja.ml_user_id as number, janela.inicioDia, janela.agora);
  const vendasPorItem = new Map<string, number>();
  for (const o of orders) {
    if (!STATUS_VALIDOS.has(o.status)) continue;
    for (const oi of o.order_items) {
      vendasPorItem.set(oi.item.id, (vendasPorItem.get(oi.item.id) ?? 0) + oi.quantity);
    }
  }

  const resultados = await comConcorrenciaLimitada(Array.from(itens.values()), 8, async (item) => {
    const visitas = await getVisitasItem(loja.id, item.id, dataInicio, dataFim);
    return { itemId: item.id, titulo: item.title, visitas: visitas ?? 0, vendas: vendasPorItem.get(item.id) ?? 0 };
  });

  return resultados
    .filter((r) => r.visitas >= MIN_VISITAS)
    .map((r) => ({ ...r, conversao: r.vendas / r.visitas }));
}

function construirLinhasConversao(linhas: ItemConversao[]): string {
  return linhas
    .map((l) => `item_id=${l.itemId}, titulo="${l.titulo}", visitas=${l.visitas}, vendas=${l.vendas}, conversao=${(l.conversao * 100).toFixed(2)}%`)
    .join("\n");
}

async function gerarAnaliseConversaoIA(loja: Loja, linhas: ItemConversao[]): Promise<void> {
  const client = obterClienteAnthropic();
  if (!client) return;

  if (linhas.length === 0) {
    await pool.query("INSERT INTO agente_conversao_pensamentos (pensamento, loja_id) VALUES ($1, $2)", [
      `Nenhum anúncio com pelo menos ${MIN_VISITAS} visitas nos últimos ${DIAS_JANELA} dias — tráfego baixo demais pra analisar conversão agora.`,
      loja.id,
    ]);
    return;
  }

  const mediaConversao = linhas.reduce((s, l) => s + l.conversao, 0) / linhas.length;
  const textoLinhas = construirLinhasConversao(linhas);

  const resposta = await client.messages.create({
    model: MODELO_IA,
    max_tokens: 2000,
    system: `Você é um analista de e-commerce experiente, especializado num grupo de lojas de tinta e material de construção que vendem no Mercado Livre.

Você recebe visitas e vendas dos últimos ${DIAS_JANELA} dias de cada anúncio ativo da loja "${loja.nome}" (só anúncios com pelo menos ${MIN_VISITAS} visitas — abaixo disso o número não é confiável). A conversão média da loja nesse grupo de anúncios é ${(mediaConversao * 100).toFixed(2)}%.

Regras:
- Separe dois padrões: anúncio com visita bem acima da média e conversão bem ABAIXO da média da loja (sinal de que algo no anúncio está quebrado — preço, foto, copy, ficha técnica) de anúncio com conversão bem ACIMA da média mas visita baixa (vale empurrar mais tráfego/Ads nele, porque quando alguém vê, compra).
- Ignore diferenças pequenas perto da média — isso é ruído normal, não vale citar.
- Cite os números reais (visitas, vendas, conversão) — não generalize.
- Texto direto, sem introdução nem despedida. Só o parágrafo(s) da análise.`,
    messages: [
      {
        role: "user",
        content: `Anúncios com tráfego suficiente nos últimos ${DIAS_JANELA} dias:\n\n${textoLinhas}\n\nAnalise.`,
      },
    ],
  });

  console.log(`Agente de Conversão (IA): ${resposta.usage.input_tokens} tokens de entrada, ${resposta.usage.output_tokens} de saída.`);

  const pensamento = resposta.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .filter((t) => t.trim().length > 0)
    .join("\n\n");

  if (pensamento) {
    await pool.query("INSERT INTO agente_conversao_pensamentos (pensamento, loja_id) VALUES ($1, $2)", [pensamento, loja.id]);
  }
}

export async function verificarAgenteConversao(): Promise<{ lojas: number; falhas: number }> {
  if (!obterClienteAnthropic()) {
    console.error("Agente de Conversão: ANTHROPIC_API_KEY não configurada — rodada pulada.");
    return { lojas: 0, falhas: 0 };
  }

  const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null && LOJAS_AGENTE.includes(l.id));
  let lojasAnalisadas = 0;
  let falhas = 0;

  for (const loja of lojas) {
    try {
      const linhas = await coletarConversaoDaLoja(loja);
      await gerarAnaliseConversaoIA(loja, linhas);
      lojasAnalisadas++;
    } catch (err) {
      console.error(`Agente de Conversão (loja ${loja.id}): falha na checagem, loja pulada nessa rodada:`, err);
      falhas++;
      await pool
        .query("INSERT INTO agente_conversao_pensamentos (pensamento, loja_id) VALUES ($1, $2)", [
          "Não consegui checar essa loja nessa rodada (falha ao buscar visitas/vendas ou ao analisar) — tento de novo na próxima checagem.",
          loja.id,
        ])
        .catch((erroInsert) => console.error(`Agente de Conversão (loja ${loja.id}): falha ao registrar o aviso de erro:`, erroInsert));
    }
  }

  return { lojas: lojasAnalisadas, falhas };
}

export interface PensamentoConversao {
  id: number;
  pensamento: string;
  criadoEm: string;
  lojaId: number | null;
  lojaNome: string | null;
}

export async function listarPensamentosConversao(limite = 20): Promise<PensamentoConversao[]> {
  const { rows } = await pool.query<{
    id: number;
    pensamento: string;
    criado_em: string;
    loja_id: number | null;
    loja_nome: string | null;
  }>(
    `SELECT p.id, p.pensamento, p.criado_em, p.loja_id, l.nome AS loja_nome
     FROM agente_conversao_pensamentos p
     LEFT JOIN lojas l ON l.id = p.loja_id
     ORDER BY p.criado_em DESC
     LIMIT $1`,
    [limite]
  );
  return rows.map((r) => ({ id: r.id, pensamento: r.pensamento, criadoEm: r.criado_em, lojaId: r.loja_id, lojaNome: r.loja_nome }));
}

// Métrica mais lenta que Ads (30 dias de visitas não muda hora a hora) —
// 1x/dia é suficiente. Mesma técnica de "horário-âncora" do resto dos
// agentes (ver agenteAdsService.ts).
const HORARIO_VERIFICACAO = [8]; // horário de Brasília
const INTERVALO_CHECAGEM_HORARIO_MS = 5 * 60 * 1000; // 5min

export function iniciarVerificacaoAgenteConversao(): void {
  let ultimaJanela = chaveJanelaDoDia(HORARIO_VERIFICACAO);
  setInterval(async () => {
    const janela = chaveJanelaDoDia(HORARIO_VERIFICACAO);
    if (janela === ultimaJanela) return;
    ultimaJanela = janela;
    try {
      const resultado = await verificarAgenteConversao();
      console.log(`Agente de Conversão: ${resultado.lojas} loja(s) analisada(s), ${resultado.falhas} falha(s).`);
    } catch (err) {
      console.error("Erro na verificação do agente de Conversão:", err);
    }
  }, INTERVALO_CHECAGEM_HORARIO_MS);
}
