import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import { obterPainelAds, type ContaAds, type CampanhaRanking } from "./adsPainelService";
import { extrairRespostaEPensamento } from "./growthHackerService";

const formatCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format;

let clienteAnthropic: Anthropic | null | undefined;
function obterClienteAnthropic(): Anthropic | null {
  if (clienteAnthropic === undefined) {
    clienteAnthropic = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;
  }
  return clienteAnthropic;
}

const MODELO = "claude-opus-5";
// task_budget.total tem um mínimo de 20000 tokens pra esse modelo (erro real
// ao vivo com 10000: "must be at least 20,000 tokens for this model") — não
// dá pra ir mais barato que isso independente de a resposta ser curta.
// max_tokens continua sendo só a rede de segurança (corte duro), acima do
// task_budget de propósito, mesmo espírito do Growth Hacker/Consultor
// (64000/48000) só que num teto bem menor, já que a resposta aqui é uma
// lista curta de ações, não um diagnóstico — gasto real menor na prática.
const MAX_TOKENS = 24000;
const TASK_BUDGET = 20000;

// Monta o contexto a partir do que o Controle de Ads JÁ calculou (mesmo
// obterPainelAds que a tela usa, com o mesmo cache) — não refaz nenhuma
// conta nem bate de novo no Mercado Livre, só traduz os números pra texto.
function construirContexto(contas: ContaAds[], campanhas: CampanhaRanking[]): string {
  const linhasContas = contas
    .map((c) =>
      [
        `loja="${c.lojaNome}"`,
        `nivel=${c.nivel.toUpperCase()}`,
        `margem_pos_ads=${c.margemPosAds === null ? "sem dado" : `${c.margemPosAds.toFixed(1)}%`}`,
        `roas=${c.roas === null ? "sem dado" : `${c.roas.toFixed(2)}x`}`,
        `roas_equilibrio=${c.roasEquilibrio === null ? "sem dado" : `${c.roasEquilibrio.toFixed(2)}x`}`,
        `gasto=${formatCurrency(c.gasto)}`,
        `lucro_apos_ads=${c.lucroAposAds === null ? "sem dado (falta custo cadastrado)" : formatCurrency(c.lucroAposAds)}`,
        `gasto_sem_venda=${formatCurrency(c.gastoSemVenda)}`,
      ].join(", ")
    )
    .join("\n");

  // Só as campanhas que pedem decisão (sangria ou motor) — atenção e sem
  // dado não mudam a ação a tomar, só inflariam o contexto à toa.
  const relevantes = campanhas.filter((c) => c.nivel === "sangria" || c.nivel === "motor");
  const linhasCampanhas =
    relevantes.length === 0
      ? "Nenhuma campanha em sangria ou motor com gasto relevante no período."
      : relevantes
          .map((c) =>
            [
              `loja="${c.lojaNome}"`,
              `campanha="${c.nome}"`,
              `nivel=${c.nivel.toUpperCase()}`,
              `gasto=${formatCurrency(c.gasto)}`,
              `receita=${formatCurrency(c.receita)}`,
              `roas=${c.roas === null ? "sem venda" : `${c.roas.toFixed(2)}x`}`,
              `margem_pos_ads=${c.margemPosAds === null ? "sem dado" : `${c.margemPosAds.toFixed(1)}%`}`,
            ].join(", ")
          )
          .join("\n");

  return `=== SUAS 4 LOJAS — visão geral do período ===\n${linhasContas}\n\n=== CAMPANHAS QUE PEDEM DECISÃO (sangria ou motor) ===\n${linhasCampanhas}`;
}

const TIPOS_VALIDOS = ["pausar", "reduzir", "escalar", "revisar", "cadastrar"] as const;
type TipoAcao = (typeof TIPOS_VALIDOS)[number];

const PERSONA = `Você é um especialista em tráfego pago (Mercado Ads) olhando o Controle de Ads pessoal do dono — só as 4 lojas dele (Hangar, Catedral Impermeabilizantes, Inga Collors, Perpétua), nada do resto do grupo.

Responda SOMENTE com um JSON válido, sem markdown, sem \`\`\`, sem nenhum texto antes ou depois — só o array. Formato: um array de objetos, cada um:
{"tipo": "pausar" | "reduzir" | "escalar" | "revisar" | "cadastrar", "loja": "nome da loja, ou \\"Geral\\" se não for de uma loja só", "titulo": "ação no imperativo, até 10 palavras", "detalhe": "até 2 linhas, com os números reais que justificam"}

Critério de "tipo":
- "pausar": campanha claramente perdendo dinheiro, sem salvação óbvia.
- "reduzir": perdendo dinheiro mas vale só cortar orçamento, não desligar de vez.
- "revisar": precisa de uma decisão humana antes de agir (preço, frete, orçamento zerado sem motivo claro).
- "cadastrar": falta custo de produto cadastrado, bloqueando a decisão.
- "escalar": campanha ou loja saudável, vale aumentar orçamento.

No máximo 10 itens, os mais importantes primeiro (sangria antes de atenção, "escalar" por último). Agrupe campanhas pequenas e parecidas num item só em vez de repetir uma por uma. O dono pensa em ROAS, não ACOS — todo "detalhe" cita ROAS, nunca ACOS. Se não houver nada que peça ação, devolva um array com um único item tipo "revisar", loja "Geral", avisando isso — nunca invente uma ação que os números não sustentam.`;

export interface AcaoControleAds {
  tipo: TipoAcao;
  loja: string;
  titulo: string;
  detalhe: string;
}

export interface PlanoDeAcaoControleAds {
  pensamento: string | null;
  acoes: AcaoControleAds[];
}

// O modelo às vezes embrulha o JSON em ```json apesar da instrução — tira a
// cerca antes de tentar parsear, em vez de falhar por um detalhe cosmético.
function extrairAcoes(texto: string): AcaoControleAds[] {
  const limpo = texto
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let bruto: unknown;
  try {
    bruto = JSON.parse(limpo);
  } catch {
    throw new Error("A IA não respondeu num formato que eu consegui ler. Tenta gerar de novo.");
  }
  if (!Array.isArray(bruto)) {
    throw new Error("A IA não respondeu num formato que eu consegui ler. Tenta gerar de novo.");
  }

  return bruto
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      tipo: (TIPOS_VALIDOS as readonly string[]).includes(String(item.tipo)) ? (item.tipo as TipoAcao) : "revisar",
      loja: typeof item.loja === "string" && item.loja.trim() ? item.loja.trim() : "Geral",
      titulo: typeof item.titulo === "string" ? item.titulo.trim() : "",
      detalhe: typeof item.detalhe === "string" ? item.detalhe.trim() : "",
    }))
    .filter((a) => a.titulo.length > 0);
}

export async function gerarPlanoDeAcaoControleAds(inicio: string, fim: string): Promise<PlanoDeAcaoControleAds> {
  const client = obterClienteAnthropic();
  if (!client) {
    throw new Error("IA não configurada neste ambiente (falta ANTHROPIC_API_KEY).");
  }

  // Reaproveita o cache do próprio painel (ver adsPainelService) — gerar o
  // plano de ação não dispara nenhuma busca nova no Mercado Livre além da
  // que a tela já fez.
  const painel = await obterPainelAds(inicio, fim);
  const contexto = construirContexto(painel.contas, painel.campanhas);

  const resposta = await client.beta.messages
    .stream({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "xhigh", task_budget: { type: "tokens", total: TASK_BUDGET } },
      betas: ["task-budgets-2026-03-13"],
      system: PERSONA,
      messages: [{ role: "user", content: `${contexto}\n\nLista as ações a tomar agora.` }],
    })
    .finalMessage();

  console.log(
    `Controle de Ads (plano de ação): stop_reason=${resposta.stop_reason}, ${resposta.usage.output_tokens} tokens de saída.`
  );

  const { pensamento, texto } = extrairRespostaEPensamento(resposta);
  return { pensamento, acoes: extrairAcoes(texto) };
}
