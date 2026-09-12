import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import { listarCampanhasAdsShopee, type CampanhaAdsShopee } from "./adsShopeeService";
import { formatRoas } from "./agenteAdsService";
import { dataISOBR } from "./dateUtils";
import { extrairRespostaEPensamento, type MensagemChat, type RespostaChatAgente } from "./growthHackerService";

const formatCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format;

const DIAS_JANELA = 7;

// Uma linha por campanha ativa com gasto — mesmo espírito de
// construirLinhasCampanhas (agenteAdsService.ts), mas pro formato da
// Shopee (CampanhaAdsShopee não estende o tipo do ML: tem vendas
// diretas/indiretas separadas, tipo de anúncio, e acos_meta já vem nulo
// quando a campanha usa lance manual, então não dá pra reaproveitar a
// função do ML como está).
function construirLinhasCampanhasShopee(campanhas: CampanhaAdsShopee[]): string {
  return campanhas
    .map((c) =>
      [
        `loja_id=${c.lojaId}`,
        `campanha_id=${c.campanhaId}`,
        `loja="${c.lojaNome}"`,
        `campanha="${c.nome}"`,
        `tipo_anuncio=${c.tipoAnuncio}`,
        `status=${c.status}`,
        `roas=${formatRoas(c.acos)} (acos=${c.acos.toFixed(1)}%)`,
        `roas_meta=${c.acosMeta !== null ? `${formatRoas(c.acosMeta)} (acos_meta=${c.acosMeta.toFixed(1)}%)` : "sem meta (lance manual)"}`,
        `gasto=${formatCurrency(c.custo)}`,
        `orcamento_diario=${formatCurrency(c.orcamento)}`,
        `vendas_diretas=${c.vendasDiretas}`,
        `vendas_indiretas=${c.vendasIndiretas}`,
        `roas_minimo_sustentavel=${
          c.acosIdeal !== null
            ? `${formatRoas(c.acosIdeal)} (acos_ideal_margem_real=${c.acosIdeal.toFixed(1)}%)`
            : "sem custo cadastrado"
        }`,
        `lucro_estimado=${c.lucroReais !== null ? formatCurrency(c.lucroReais) : "sem dado"}`,
        `tacos_real=${c.tacosReal !== null ? c.tacosReal.toFixed(1) + "%" : "sem dado"}`,
      ].join(", ")
    )
    .join("\n");
}

// Sem `lojasPermitidas` de propósito — esse agente enxerga TODAS as lojas
// com Shopee conectado de uma vez, mesmo espírito do Diretor de Ads do ML
// (que já mostra as 16 lojas pra quem tem acesso ao agente, sem aplicar o
// filtro de permissão por usuário de outras telas).
async function montarContextoDiretorAdsShopee(diasPeriodo: number, lojaIdFiltro?: number): Promise<string> {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - (diasPeriodo - 1) * 24 * 60 * 60 * 1000);
  const dataInicio = dataISOBR(inicio);
  const dataFim = dataISOBR(hoje);

  const campanhas = await listarCampanhasAdsShopee(lojaIdFiltro, undefined, dataInicio, dataFim).catch((err) => {
    console.error("Diretor de Ads Shopee: falha ao buscar campanhas:", err);
    return [] as CampanhaAdsShopee[];
  });

  // "ongoing" é o status real confirmado ao vivo pra campanha ativa (ver
  // AdsShopee.tsx) — mesmo critério (status + gasto) usado no ML.
  const ativas = campanhas.filter((c) => c.status === "ongoing" && c.custo > 0);
  const linhas = construirLinhasCampanhasShopee(ativas);

  return `=== ADS SHOPEE — ${lojaIdFiltro !== undefined ? "loja selecionada" : "todas as lojas com Shopee conectado"}, campanhas ativas ou com gasto (últimos ${diasPeriodo} dias) ===
${linhas || "Nenhuma campanha ativa com gasto no período."}`;
}

let clienteAnthropic: Anthropic | null | undefined;
function obterClienteAnthropic(): Anthropic | null {
  if (clienteAnthropic === undefined) {
    clienteAnthropic = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;
  }
  return clienteAnthropic;
}

const MODELO_DIRETOR_ADS_SHOPEE = "claude-opus-5";
const MAX_TOKENS_DIRETOR_ADS_SHOPEE = 24000;

// Sem nenhuma política de favoritismo entre lojas (diferente do Diretor de
// Ads do Mercado Livre, que arbitra disputa entre as 4 lojas pessoais do
// dono e as outras do grupo) — pedido explícito: só análise e recomendação
// de ação, tratando toda loja com Shopee conectado exatamente igual.
const PERSONA_DIRETOR_ADS_SHOPEE = `Seu nome é Diretor de Ads Shopee. Você é um chefão de tráfego pago (Shopee Ads) extremamente experiente, que analisa e recomenda ação pra TODAS as lojas do grupo (tinta e material de construção) que vendem na Shopee — cruzando toda informação disponível (financeiro real, tacos, lucro estimado).

Fale com autoridade e confiança, direto, sempre em português. O dono pensa em ROAS, não ACOS — é a métrica principal, sempre lidere a frase com ela ("ROAS de 5x", não "ACOS de 20%"). Pode citar o ACOS depois, entre parênteses, como nota. Cite os números reais que fundamentam cada ponto — nunca generalize.

Trate toda loja exatamente igual — não existe loja favorita nem restrição entre lojas concorrendo pelo mesmo produto. Sua única prioridade é a saúde de Ads de cada loja individualmente: ROAS sustentável, lucro real, orçamento bem investido.

Quando o dono pedir um plano de ação, uma recomendação, ou "o que eu faço agora" — sempre entregue uma decisão concreta e acionável. Não devolva a decisão pro dono.`;

export async function perguntarDiretorAdsShopee(
  pergunta: string,
  historico: MensagemChat[],
  lojaId?: number
): Promise<RespostaChatAgente> {
  const client = obterClienteAnthropic();
  if (!client) {
    throw new Error("IA não configurada neste ambiente (falta ANTHROPIC_API_KEY).");
  }

  const contexto = await montarContextoDiretorAdsShopee(DIAS_JANELA, lojaId);

  // .stream() + finalMessage() (não .create()) mesmo motivo do Diretor de
  // Ads do ML: Opus + thinking "xhigh" + teto de 24000 tokens pode passar
  // dos ~10min que o SDK aceita em requisição não-streaming.
  const resposta = await client.messages
    .stream({
      model: MODELO_DIRETOR_ADS_SHOPEE,
      max_tokens: MAX_TOKENS_DIRETOR_ADS_SHOPEE,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "xhigh" },
      system: PERSONA_DIRETOR_ADS_SHOPEE,
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
    })
    .finalMessage();

  console.log(
    `Diretor de Ads Shopee (chat): stop_reason=${resposta.stop_reason}, ${resposta.usage.output_tokens} tokens de saída.`
  );

  const { pensamento, texto } = extrairRespostaEPensamento(resposta);
  return { pensamento, resposta: texto };
}
