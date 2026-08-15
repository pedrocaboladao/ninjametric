import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import { listLojas, type Loja } from "./tokenStore";
import { listarVendasFinanceiras, normalizarSku, type VendaFinanceira } from "./financeiroService";
import { calcularMargem } from "./agenteCatalogoService";
import { getItemsBasicInfo, getTaxaMlParaPreco } from "./mercadoLivreApi";
import { listarProdutos } from "./produtosService";
import { LOJAS_AGENTE } from "./agenteAdsService";
import { dataISOBR } from "./dateUtils";
import { extrairRespostaEPensamento, type MensagemChat, type RespostaChatAgente } from "./growthHackerService";

const formatCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format;
const formatPercent = (n: number) => `${n.toFixed(1)}%`;

// 3 baldes de 30 dias — a melhor aproximação de "histórico de preço" que dá
// pra reconstruir hoje, já que não existe nenhuma tabela que registre o
// preço do anúncio ao longo do tempo (só o preço PAGO em cada venda já
// realizada). Ver comentário na persona sobre honestidade dessa limitação.
const DIAS_HISTORICO = 90;
const TAMANHO_BALDE_DIAS = 30;
const MAX_SKUS_CANDIDATOS = 6;
const MIN_LETRAS_PALAVRA = 4;

async function idsOutrasLojas(): Promise<number[]> {
  const lojas = await listLojas();
  return lojas.filter((l) => l.ml_user_id !== null && !LOJAS_AGENTE.includes(l.id)).map((l) => l.id);
}

// --- Identificação do produto a partir da pergunta livre ---
// Não existe busca por nome/título no sistema, só por SKU. Extrai palavras
// de 4+ letras da pergunta e testa cada uma como substring do SKU (mesmo
// critério de buscarComparacaoPorSku em precificacaoService.ts) — funciona
// bem porque a convenção de SKU das lojas embute o nome do produto
// (ex.: "RESIFLEX-18KG-MARROM-TELHA").

function extrairPalavrasCandidatas(pergunta: string): string[] {
  return Array.from(
    new Set(
      pergunta
        .split(/[^\p{L}\p{N}]+/u)
        .map((p) => normalizarSku(p))
        .filter((p) => p.length >= MIN_LETRAS_PALAVRA)
    )
  );
}

export interface CandidatoSku {
  skuNorm: string;
  titulo: string;
  volumeTotal: number;
}

export function encontrarSkusCandidatos(pergunta: string, vendasProprias: VendaFinanceira[]): CandidatoSku[] {
  const palavras = extrairPalavrasCandidatas(pergunta);
  if (palavras.length === 0) return [];

  const porSku = new Map<string, CandidatoSku>();
  for (const v of vendasProprias) {
    if (!v.sku) continue;
    const skuNorm = normalizarSku(v.sku);
    if (!palavras.some((p) => skuNorm.includes(p))) continue;
    const atual = porSku.get(skuNorm);
    if (!atual) {
      porSku.set(skuNorm, { skuNorm, titulo: v.titulo, volumeTotal: v.quantidade });
    } else {
      atual.volumeTotal += v.quantidade;
    }
  }

  return Array.from(porSku.values())
    .sort((a, b) => b.volumeTotal - a.volumeTotal)
    .slice(0, MAX_SKUS_CANDIDATOS);
}

// --- Análise por SKU, loja por loja ---

interface BaldeSku {
  rotulo: string;
  precoMedio: number | null;
  quantidadeVendida: number;
  margemPercentualMedia: number | null;
}

interface SimulacaoPreco {
  percentualAumento: number;
  precoSimulado: number;
  margemSimulada: number | null;
  margemPercentualSimulada: number | null;
}

interface AnaliseLojaPropria {
  lojaId: number;
  lojaNome: string;
  baldes: BaldeSku[];
  precoAtual: number | null;
  margemAtual: number | null;
  margemPercentualAtual: number | null;
  simulacoes: SimulacaoPreco[];
}

const ROTULOS_BALDE = ["Últimos 30 dias", "31-60 dias atrás", "61-90 dias atrás"];

// vendasDoSku já vem filtrada pro SKU normalizado e ordenada por data desc
// (listarVendasFinanceiras já ordena assim) — a primeira venda de cada loja
// é a mais recente, usada pra achar o item_id do anúncio ativo hoje.
async function montarAnalisePorLoja(
  skuNorm: string,
  vendasDoSku: VendaFinanceira[],
  custoPorSku: Map<string, number>,
  lojasPorId: Map<number, Loja>
): Promise<AnaliseLojaPropria[]> {
  const porLoja = new Map<number, VendaFinanceira[]>();
  for (const v of vendasDoSku) {
    const lista = porLoja.get(v.lojaId) ?? [];
    lista.push(v);
    porLoja.set(v.lojaId, lista);
  }

  const agora = Date.now();
  const umDiaMs = 24 * 60 * 60 * 1000;
  const custoUnitario = custoPorSku.get(skuNorm) ?? null;

  return Promise.all(
    Array.from(porLoja.entries()).map(async ([lojaId, vendasDaLoja]): Promise<AnaliseLojaPropria> => {
      const baldes: BaldeSku[] = ROTULOS_BALDE.map((rotulo, i) => {
        const diasMin = i * TAMANHO_BALDE_DIAS;
        const diasMax = (i + 1) * TAMANHO_BALDE_DIAS;
        const vendasBalde = vendasDaLoja.filter((v) => {
          const diasAtras = (agora - new Date(v.dataCriacao).getTime()) / umDiaMs;
          return diasAtras >= diasMin && diasAtras < diasMax;
        });
        if (vendasBalde.length === 0) {
          return { rotulo, precoMedio: null, quantidadeVendida: 0, margemPercentualMedia: null };
        }
        const quantidadeVendida = vendasBalde.reduce((s, v) => s + v.quantidade, 0);
        const precoMedio = vendasBalde.reduce((s, v) => s + v.valorUnitario * v.quantidade, 0) / quantidadeVendida;
        const comMargem = vendasBalde.filter((v) => v.margemPercentual !== null);
        const margemPercentualMedia =
          comMargem.length > 0 ? comMargem.reduce((s, v) => s + v.margemPercentual!, 0) / comMargem.length : null;
        return { rotulo, precoMedio, quantidadeVendida, margemPercentualMedia };
      });

      const loja = lojasPorId.get(lojaId);
      const maisRecente = vendasDaLoja[0];

      let precoAtual: number | null = null;
      let margemAtual: number | null = null;
      let margemPercentualAtual: number | null = null;
      const simulacoes: SimulacaoPreco[] = [];

      try {
        const itens = await getItemsBasicInfo(lojaId, [maisRecente.itemId]);
        const item = itens.get(maisRecente.itemId);
        if (item && loja && item.category_id && item.listing_type_id) {
          precoAtual = item.price;
          const taxaAtual = await getTaxaMlParaPreco(lojaId, item.category_id, item.listing_type_id, precoAtual);
          margemAtual = calcularMargem(precoAtual, custoUnitario, taxaAtual, loja.imposto_percentual);
          margemPercentualAtual =
            margemAtual !== null && precoAtual > 0 ? (margemAtual / precoAtual) * 100 : null;

          for (const percentualAumento of [5, 10]) {
            const precoSimulado = precoAtual * (1 + percentualAumento / 100);
            const taxaSimulada = await getTaxaMlParaPreco(lojaId, item.category_id, item.listing_type_id, precoSimulado);
            const margemSimulada = calcularMargem(precoSimulado, custoUnitario, taxaSimulada, loja.imposto_percentual);
            simulacoes.push({
              percentualAumento,
              precoSimulado,
              margemSimulada,
              margemPercentualSimulada:
                margemSimulada !== null && precoSimulado > 0 ? (margemSimulada / precoSimulado) * 100 : null,
            });
          }
        }
      } catch (err) {
        console.error(
          `Consultor de Precificação: falha ao buscar preço ao vivo do item ${maisRecente.itemId} (loja ${lojaId}):`,
          err
        );
      }

      return {
        lojaId,
        lojaNome: loja?.nome ?? maisRecente.lojaNome,
        baldes,
        precoAtual,
        margemAtual,
        margemPercentualAtual,
        simulacoes,
      };
    })
  );
}

interface DadosMercadoSku {
  lojaId: number;
  lojaNome: string;
  precoMedio: number;
  quantidadeVendida: number;
  margemPercentualMedia: number | null;
}

function montarDadosMercado(skuNorm: string, vendasOutras: VendaFinanceira[]): DadosMercadoSku[] {
  const umMesAtras = Date.now() - 30 * 24 * 60 * 60 * 1000;
  interface Agregado {
    lojaNome: string;
    somaPreco: number;
    quantidade: number;
    somaMargem: number;
    qtdComMargem: number;
  }
  const porLoja = new Map<number, Agregado>();

  for (const v of vendasOutras) {
    if (!v.sku || normalizarSku(v.sku) !== skuNorm) continue;
    if (new Date(v.dataCriacao).getTime() < umMesAtras) continue;
    const atual = porLoja.get(v.lojaId) ?? { lojaNome: v.lojaNome, somaPreco: 0, quantidade: 0, somaMargem: 0, qtdComMargem: 0 };
    atual.somaPreco += v.valorUnitario * v.quantidade;
    atual.quantidade += v.quantidade;
    if (v.margemPercentual !== null) {
      atual.somaMargem += v.margemPercentual;
      atual.qtdComMargem += 1;
    }
    porLoja.set(v.lojaId, atual);
  }

  return Array.from(porLoja.entries()).map(([lojaId, d]) => ({
    lojaId,
    lojaNome: d.lojaNome,
    precoMedio: d.somaPreco / d.quantidade,
    quantidadeVendida: d.quantidade,
    margemPercentualMedia: d.qtdComMargem > 0 ? d.somaMargem / d.qtdComMargem : null,
  }));
}

function formatarAnaliseSku(candidato: CandidatoSku, porLoja: AnaliseLojaPropria[], mercado: DadosMercadoSku[]): string {
  const linhasLojas = porLoja
    .map((l) => {
      const linhasBaldes = l.baldes
        .map((b) =>
          b.quantidadeVendida > 0
            ? `  ${b.rotulo}: ${b.quantidadeVendida} un., preço médio pago ${formatCurrency(b.precoMedio!)}${
                b.margemPercentualMedia !== null ? `, margem ${formatPercent(b.margemPercentualMedia)}` : ""
              }`
            : `  ${b.rotulo}: sem vendas nesse período`
        )
        .join("\n");

      const linhaAtual =
        l.precoAtual !== null
          ? `  Preço do anúncio ativo agora: ${formatCurrency(l.precoAtual)}${
              l.margemPercentualAtual !== null
                ? ` (margem ${formatPercent(l.margemPercentualAtual)}, ${formatCurrency(l.margemAtual!)})`
                : " (não deu pra calcular margem — falta custo cadastrado ou categoria/tipo do anúncio)"
            }`
          : "  Não consegui achar o preço do anúncio ativo agora (item pode estar pausado/alterado) — use o preço médio de venda recente como referência.";

      const linhasSimulacao = l.simulacoes
        .map(
          (s) =>
            `  Se subir ${s.percentualAumento}% (preço ${formatCurrency(s.precoSimulado)}): margem ${
              s.margemPercentualSimulada !== null ? formatPercent(s.margemPercentualSimulada) : "não calculável"
            }${s.margemSimulada !== null ? ` (${formatCurrency(s.margemSimulada)})` : ""}`
        )
        .join("\n");

      return `-- ${l.lojaNome} --\n${linhasBaldes}\n${linhaAtual}\n${linhasSimulacao}`;
    })
    .join("\n\n");

  const linhasMercado =
    mercado.length > 0
      ? mercado
          .map(
            (m) =>
              `  ${m.lojaNome}: preço médio ${formatCurrency(m.precoMedio)}, ${m.quantidadeVendida} un. vendidas, margem ${
                m.margemPercentualMedia !== null ? formatPercent(m.margemPercentualMedia) : "n/d"
              } (últimos 30 dias)`
          )
          .join("\n")
      : "  Nenhuma outra loja do grupo vendeu esse produto nos últimos 30 dias.";

  return `=== PRODUTO: ${candidato.titulo} (SKU ${candidato.skuNorm}) ===
--- Suas lojas (histórico reconstruído a partir de vendas reais — não é o preço de tabela do anúncio ao longo do tempo, ver instrução sobre essa limitação) ---
${linhasLojas}

--- Contexto de mercado: mesmo produto em outras lojas do grupo (não são suas, nunca recomende ação pra elas) ---
${linhasMercado}`;
}

async function montarContextoConsultorPreco(pergunta: string): Promise<string> {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - (DIAS_HISTORICO - 1) * 24 * 60 * 60 * 1000);
  const dataInicio = dataISOBR(inicio);
  const dataFim = dataISOBR(hoje);

  const outras = await idsOutrasLojas();

  const [lojas, produtos, { vendas: vendasProprias }, resultadoOutras] = await Promise.all([
    listLojas(),
    listarProdutos(),
    listarVendasFinanceiras(undefined, LOJAS_AGENTE, dataInicio, dataFim),
    listarVendasFinanceiras(undefined, outras, dataInicio, dataFim).catch((err) => {
      console.error("Consultor de Precificação: falha ao buscar vendas das outras lojas do grupo:", err);
      return { vendas: [] as VendaFinanceira[] };
    }),
  ]);
  const vendasOutras = resultadoOutras.vendas;

  const custoPorSku = new Map(produtos.map((p) => [normalizarSku(p.sku), p.custo]));
  const lojasPorId = new Map(lojas.map((l) => [l.id, l]));

  const candidatos = encontrarSkusCandidatos(pergunta, vendasProprias);

  if (candidatos.length === 0) {
    return `=== BUSCA DE PRODUTO ===
Não consegui identificar nenhum produto das suas 4 lojas a partir dessa pergunta (nenhuma palavra bateu com um SKU vendido nos últimos ${DIAS_HISTORICO} dias). Peça pro dono confirmar o nome ou o código (SKU) exato do produto antes de dar qualquer recomendação de preço.`;
  }

  const secoes = await Promise.all(
    candidatos.map(async (c) => {
      const vendasDoSku = vendasProprias.filter((v) => v.sku && normalizarSku(v.sku) === c.skuNorm);
      const porLoja = await montarAnalisePorLoja(c.skuNorm, vendasDoSku, custoPorSku, lojasPorId);
      const mercado = montarDadosMercado(c.skuNorm, vendasOutras);
      return formatarAnaliseSku(c, porLoja, mercado);
    })
  );

  return secoes.join("\n\n");
}

// --- Chamada à IA ---

let clienteAnthropic: Anthropic | null | undefined;
function obterClienteAnthropic(): Anthropic | null {
  if (clienteAnthropic === undefined) {
    clienteAnthropic = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;
  }
  return clienteAnthropic;
}

const MODELO_CONSULTOR_PRECO = "claude-opus-5";
// Mesmos valores usados no Growth Hacker (ver comentário lá) — já nasce com
// esses tetos em vez de descobrir corte de resposta depois.
const MAX_TOKENS_CONSULTOR_PRECO = 64000;
const TASK_BUDGET_CONSULTOR_PRECO = 48000;

const PERSONA_CONSULTOR_PRECO = `Seu nome é Consultor de Precificação. Você é um especialista em precificação e elasticidade de demanda no varejo de e-commerce, com décadas de experiência montando estratégia de preço pra operações de venda online — sabe equilibrar margem e volume, não vive de uma métrica isolada.

Fale com autoridade e confiança, direto, sempre em português. O dono te traz uma pergunta sobre um produto específico (ex.: "devo aumentar o preço do X pra ganhar margem, ou vou perder volume?") — sua resposta precisa ser uma recomendação concreta: subir, manter ou baixar o preço, com o motivo baseado nos números que você recebe. Não devolva a decisão pro dono.

LIMITAÇÃO IMPORTANTE DOS DADOS — seja honesto sobre isso: você NÃO tem acesso a um histórico real de preço do anúncio (não existe registro de "o preço era X em tal data"). O que você recebe é reconstruído a partir das vendas de fato realizadas: preço médio pago e volume vendido em 3 janelas de 30 dias (últimos 30, 31-60 e 61-90 dias atrás). Isso reflete mudanças de preço que já aconteceram na prática (inclusive promoções), mas não é uma curva de preço do anúncio. Se as 3 janelas mostrarem preço praticamente igual, significa que NÃO HÁ sinal de elasticidade pra analisar nesse período — diga isso claramente em vez de inventar uma previsão de queda de volume sem dado real que a sustente. Use as simulações de margem (a +5%/+10% do preço atual, já calculadas com a taxa real do Mercado Livre pra cada preço) pra mostrar o ganho de margem esperado com confiança — essa parte é dado real, não estimativa.

Se a seção "BUSCA DE PRODUTO" avisar que nenhum produto foi identificado, NÃO tente adivinhar — peça pro dono confirmar o nome ou o SKU exato do produto.

Quando o produto é vendido por mais de uma das 4 lojas pessoais, trate cada loja separadamente na sua análise (preço, margem e volume podem ser bem diferentes entre elas) — não misture os números.

Se o mesmo produto aparecer no "contexto de mercado" (outras lojas do grupo, 12+ contas), use isso só como referência de quanto o mercado está cobrando e a margem que tira — nunca recomende mudança de configuração pra elas, não são do dono.

Seja econômico no texto: vá direto na recomendação e nos números que a sustentam, sem repetir contexto que o dono já sabe, sem alongar em ressalvas óbvias.`;

export async function perguntarConsultorPreco(pergunta: string, historico: MensagemChat[]): Promise<RespostaChatAgente> {
  const client = obterClienteAnthropic();
  if (!client) {
    throw new Error("IA não configurada neste ambiente (falta ANTHROPIC_API_KEY).");
  }

  const contexto = await montarContextoConsultorPreco(pergunta);

  const resposta = await client.beta.messages
    .stream({
      model: MODELO_CONSULTOR_PRECO,
      max_tokens: MAX_TOKENS_CONSULTOR_PRECO,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "xhigh", task_budget: { type: "tokens", total: TASK_BUDGET_CONSULTOR_PRECO } },
      betas: ["task-budgets-2026-03-13"],
      system: PERSONA_CONSULTOR_PRECO,
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
    `Consultor de Precificação (chat): stop_reason=${resposta.stop_reason}, ${resposta.usage.output_tokens} tokens de saída.`
  );

  const { pensamento, texto } = extrairRespostaEPensamento(resposta);
  return { pensamento, resposta: texto };
}
