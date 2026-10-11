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
// Formato igual ao plano de ação manual que o dono já usa fora do painel
// (tabela por campanha, ação com número exato) — lista TODA campanha
// relevante, não um resumo de 10 itens, então o teto precisa do mesmo
// tamanho do Growth Hacker/Consultor (64000/48000), não do teto enxuto da
// versão anterior desse recurso.
const MAX_TOKENS = 64000;
const TASK_BUDGET = 48000;

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

  // Campanhas com gasto relevante (já filtrado por obterPainelAds) — manda
  // TODAS, não só sangria/motor: a IA precisa ver "atencao" e "sem_dados"
  // também pra decidir entre cortar/escalar/revisar/cadastrar com precisão,
  // igual o plano de referência do dono separa isso em passos diferentes.
  const linhasCampanhas =
    campanhas.length === 0
      ? "Nenhuma campanha com gasto relevante no período."
      : campanhas
          .map((c) =>
            [
              `loja="${c.lojaNome}"`,
              `campanha="${c.nome}"`,
              `status=${c.status}`,
              `gasto=${formatCurrency(c.gasto)}`,
              `receita=${formatCurrency(c.receita)}`,
              `roas=${c.roas === null ? "sem venda" : `${c.roas.toFixed(2)}x`}`,
              `margem_pos_ads=${c.margemPosAds === null ? "sem dado" : `${c.margemPosAds.toFixed(1)}%`}`,
              `lucro_apos_ads=${c.lucroAposAds === null ? "sem dado (falta custo cadastrado)" : formatCurrency(c.lucroAposAds)}`,
              `itens_sem_custo=${c.itensSemCusto}`,
            ].join(", ")
          )
          .join("\n");

  return `=== SUAS 4 LOJAS — visão geral do período (roas_equilibrio é o ROAS mínimo sustentável da loja) ===\n${linhasContas}\n\n=== CAMPANHAS COM GASTO RELEVANTE NO PERÍODO ===\n${linhasCampanhas}`;
}

const PERSONA = `Você é um especialista em tráfego pago (Mercado Ads) montando o plano operacional de Ads do dono — só as 4 lojas pessoais dele (Hangar, Catedral Impermeabilizantes, Inga Collors, Perpétua), nada do resto do grupo. O formato é o de um plano operacional "mão na massa": tabela por campanha, cada linha com uma ação com NÚMERO EXATO, nunca uma recomendação vaga.

Responda SOMENTE com um JSON válido, sem markdown, sem \`\`\`, sem nenhum texto antes ou depois — só o objeto. Formato exato:
{
  "resumo": "1-2 frases dizendo o estado geral da conta (ex.: piorou, estável, melhorou) e qual é a prioridade agora — mesmo tom de um resumo executivo, cita o ROAS geral.",
  "regraDaSemana": "1 frase, a regra principal a seguir essa semana (ex.: não aumentar investimento total, só realocar).",
  "cortar": [ { "campanha": "...", "loja": "...", "roas": número ou null se sem venda, "roasMinimo": número ou null, "gasto": número, "acao": "..." } ],
  "escalar": [ { "campanha": "...", "loja": "...", "roas": número, "roasMinimo": número ou null, "gasto": número, "acao": "..." } ],
  "margem": [ { "campanha": "...", "loja": "...", "roas": número, "roasMinimo": número ou null, "resultado": número (lucro/prejuízo estimado, negativo se prejuízo), "acao": "..." } ]
}

CRITÉRIO DE CADA TABELA:
- "cortar": campanhas com ROAS abaixo do ROAS mínimo da loja (roas_equilibrio), ou sem nenhuma venda no período. Toda campanha nessa situação entra, uma linha por campanha — não resuma nem agrupe.
- "escalar": campanhas com ROAS igual ou acima do mínimo E lucro_apos_ads positivo ou sem dado de custo. Toda campanha saudável entra.
- "margem": campanhas com ROAS igual ou acima do mínimo MAS lucro_apos_ads negativo — o ROAS parece bom mas o produto está dando prejuízo depois do custo real. Essas NÃO entram em "escalar".

REGRA PRA ESCREVER O CAMPO "acao" (sempre uma instrução curta e quantificada, no padrão abaixo — nunca "revisar" ou "ajustar" sozinho, sempre com o número):
- Em "cortar": calcule a razão = roas ÷ roasMinimo (quando os dois existirem).
  - Sem venda nenhuma (roas null) → "PAUSAR".
  - razão ≤ 0,3 → "PAUSAR" (ou "Cortar lance 70%" se o dono parecer estar testando algo novo).
  - razão entre 0,3 e 0,55 → "Cortar lance 60%" ou "Cortar 50%".
  - razão entre 0,55 e 0,75 → "Cortar 40%" ou "Cortar 45%".
  - razão entre 0,75 e 1,0 → "Cortar 25%" ou "Cortar 30%".
  - roasMinimo sem dado (loja sem custo cadastrado) → "PAUSAR — sem custo cadastrado, ROAS mínimo desconhecido".
- Em "escalar": calcule a razão = roas ÷ roasMinimo.
  - razão entre 1x e 2x → "Lance +20%" ou "Lance +30%".
  - razão entre 2x e 5x → "Lance +30% agora; repetir +30% a cada 48h se ROAS continuar acima de 2x o mínimo".
  - razão acima de 5x com gasto baixo (ROAS gigante, pouco volume) → "Lance +50%; alvo de gasto R$X/semana" (X = algo entre 3x e 6x o gasto atual) — explique que ROAS deve CAIR ao escalar, o que importa é o lucro em reais, não manter o ROAS alto.
- Em "margem": "Congelar gasto. Revisar preço/custo/frete antes de mexer no lance" quando o prejuízo for grande; "Subir preço 3%-5%. Não escalar até corrigir a margem" quando for pequeno e perto de zero.

O dono pensa em ROAS, não ACOS — nunca cite ACOS. Seja honesto: se uma tabela ficar vazia, devolva array vazio nela, não invente linha.`;

export interface LinhaAcaoCampanha {
  campanha: string;
  loja: string;
  roas: number | null;
  roasMinimo: number | null;
  gasto: number | null;
  resultado: number | null;
  acao: string;
}

export interface LinhaGovernancaAds {
  loja: string;
  vendasSemCusto: number;
  skus: string[];
}

export interface PlanoDeAcaoControleAds {
  pensamento: string | null;
  resumo: string;
  regraDaSemana: string;
  cortar: LinhaAcaoCampanha[];
  escalar: LinhaAcaoCampanha[];
  margem: LinhaAcaoCampanha[];
  // Única fase que NÃO vem da IA: monta direto dos dados reais (SKUs sem
  // custo cadastrado, ver ContaAds.skusSemCusto) — não tem por que arriscar
  // a IA inventar ou esquecer um SKU que já sabemos exatamente quais são.
  governanca: LinhaGovernancaAds[];
}

function numeroOuNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function textoOuVazio(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function extrairLinhas(v: unknown): LinhaAcaoCampanha[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      campanha: textoOuVazio(item.campanha),
      loja: textoOuVazio(item.loja) || "—",
      roas: numeroOuNull(item.roas),
      roasMinimo: numeroOuNull(item.roasMinimo),
      gasto: numeroOuNull(item.gasto),
      resultado: numeroOuNull(item.resultado),
      acao: textoOuVazio(item.acao),
    }))
    .filter((l) => l.campanha.length > 0 && l.acao.length > 0);
}

// O modelo às vezes embrulha o JSON em ```json apesar da instrução — tira a
// cerca antes de tentar parsear, em vez de falhar por um detalhe cosmético.
function extrairPlano(texto: string): Omit<PlanoDeAcaoControleAds, "pensamento" | "governanca"> {
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
  if (!bruto || typeof bruto !== "object") {
    throw new Error("A IA não respondeu num formato que eu consegui ler. Tenta gerar de novo.");
  }
  const obj = bruto as Record<string, unknown>;
  return {
    resumo: textoOuVazio(obj.resumo) || "Sem resumo.",
    regraDaSemana: textoOuVazio(obj.regraDaSemana),
    cortar: extrairLinhas(obj.cortar),
    escalar: extrairLinhas(obj.escalar),
    margem: extrairLinhas(obj.margem),
  };
}

// Monta a fase de governança direto dos dados reais (sem IA) — cada loja com
// venda sem custo cadastrado vira uma linha com os SKUs exatos a cadastrar.
function montarGovernanca(contas: ContaAds[]): LinhaGovernancaAds[] {
  return contas
    .filter((c) => c.vendasSemCusto > 0)
    .map((c) => ({ loja: c.lojaNome, vendasSemCusto: c.vendasSemCusto, skus: c.skusSemCusto }));
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
      messages: [{ role: "user", content: `${contexto}\n\nMonta o plano operacional.` }],
    })
    .finalMessage();

  console.log(
    `Controle de Ads (plano de ação): stop_reason=${resposta.stop_reason}, ${resposta.usage.output_tokens} tokens de saída.`
  );

  const { pensamento, texto } = extrairRespostaEPensamento(resposta);
  const plano = extrairPlano(texto);
  return { pensamento, ...plano, governanca: montarGovernanca(painel.contas) };
}
