import { listLojas } from "./tokenStore";
import { construirLinhasCampanhas, formatRoas } from "./agenteAdsService";
import { buscarCampanhasComTacosParaLojas } from "./diretorAdsService";
import { construirLinhasFinanceiroPorLojas } from "./growthHackerService";

const formatCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format;

export const DIAS_PADRAO_RELATORIO = 7;

// Texto único, pronto pra copiar e colar numa análise externa (ex.: outra
// conversa de IA usada como "memória histórica" do grupo) — junta Financeiro
// e Ads das 16 lojas num só bloco, já que nenhuma tela do sistema mostra os
// dois juntos com a profundidade das 16 lojas ao mesmo tempo. Busca tudo ao
// vivo (mesmo cache de 15min de listarVendasFinanceiras/listarCampanhasAds
// que o resto do sistema usa) — não é histórico salvo, é o retrato de agora.
export async function gerarRelatorioGeral(diasPeriodo: number = DIAS_PADRAO_RELATORIO): Promise<string> {
  const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null);
  const lojaIds = lojas.map((l) => l.id);

  const [linhasFinanceiro, campanhas] = await Promise.all([
    construirLinhasFinanceiroPorLojas(diasPeriodo, lojaIds),
    buscarCampanhasComTacosParaLojas(diasPeriodo, lojaIds),
  ]);

  const campanhasAtivas = campanhas.filter((c) => c.status === "active" && c.custo > 0);

  interface ResumoAds {
    nome: string;
    gasto: number;
    vendas: number;
  }
  const resumoPorLoja = new Map<number, ResumoAds>();
  for (const c of campanhasAtivas) {
    const atual = resumoPorLoja.get(c.lojaId) ?? { nome: c.lojaNome, gasto: 0, vendas: 0 };
    atual.gasto += c.custo;
    atual.vendas += c.vendasTotais;
    resumoPorLoja.set(c.lojaId, atual);
  }
  const linhasResumoAds =
    [...resumoPorLoja.values()]
      .map((d) => {
        // formatRoas espera ACOS (%), não a razão vendas/gasto direto —
        // ACOS = gasto ÷ vendas × 100 (mesma fórmula usada em toda a Ads).
        const acos = d.vendas > 0 ? (d.gasto / d.vendas) * 100 : null;
        return `loja="${d.nome}", gasto=${formatCurrency(d.gasto)}, vendas_atribuidas=${formatCurrency(d.vendas)}, roas=${
          acos !== null ? formatRoas(acos) : "sem venda atribuída"
        }`;
      })
      .join("\n") || "Nenhuma campanha ativa com gasto no período em nenhuma loja.";

  const linhasDetalhadoAds = construirLinhasCampanhas(campanhasAtivas) || "Nenhuma campanha ativa com gasto no período.";

  const agora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());

  return `RELATÓRIO GERAL DO GRUPO — ${lojas.length} lojas — gerado em ${agora} (últimos ${diasPeriodo} dias)
Dados ao vivo (Mercado Livre), não é histórico salvo — reflete o momento da geração.

=== RESUMO — FINANCEIRO POR LOJA ===
${linhasFinanceiro}

=== RESUMO — ADS POR LOJA (campanhas ativas com gasto) ===
${linhasResumoAds}

=== DETALHADO — CADA CAMPANHA DE ADS ATIVA COM GASTO (todas as lojas) ===
${linhasDetalhadoAds}`;
}
