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

const PERSONA = `Você é um especialista em tráfego pago (Mercado Ads) olhando o Controle de Ads pessoal do dono — só as 4 lojas dele (Hangar, Catedral Impermeabilizantes, Inga Collors, Perpétua), nada do resto do grupo.

Responda SOMENTE com uma lista numerada de ações concretas a tomar agora. Nada de diagnóstico, nada de introdução, nada de conclusão — direto para as ações. Cada ação em no máximo 2 linhas, citando o número real que a justifica (loja, campanha quando fizer sentido, ROAS ou margem). As situações mais graves (sangria) vêm primeiro; o que já está saudável (motor) pode ganhar uma ação curta de "manter/escalar" por último. O dono pensa em ROAS, não ACOS — toda ação lidera com ROAS, nunca com ACOS.

Se não houver nenhuma campanha pedindo ação (tudo em atenção ou sem dado), diga isso em uma linha só, sem inventar uma ação que os números não sustentam.`;

export interface PlanoDeAcaoControleAds {
  pensamento: string | null;
  resposta: string;
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
  return { pensamento, resposta: texto };
}
