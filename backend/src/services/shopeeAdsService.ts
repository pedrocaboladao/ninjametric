import { pool } from "../db/pool";
import { chamarApiAssinada } from "./shopeeAuth";

interface RespostaAdsDiario {
  error?: string;
  message?: string;
  response?: { date: string; expense?: number }[];
}

// A Shopee quer DD-MM-YYYY nesse endpoint (confirmado ao vivo — ver
// comentário em routes/shopeeAds.ts), diferente do resto da API que usa
// AAAA-MM-DD.
function paraDDMMYYYY(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-");
  return `${dia}-${mes}-${ano}`;
}

async function listarLojaIdsComShopeeAds(lojaIdFiltro?: number, lojasPermitidas?: number[]): Promise<number[]> {
  // O app principal já tem o escopo de Ads liberado pelo Suporte de
  // Parceiros da Shopee (ver routes/shopee.ts) — não existe mais token
  // separado pra Ads, é a mesma conta (contas_shopee) usada por
  // pedidos/financeiro.
  const { rows } = await pool.query<{ loja_id: number }>("SELECT loja_id FROM contas_shopee");
  return rows
    .map((r) => r.loja_id)
    .filter(
      (id) =>
        (lojaIdFiltro === undefined || id === lojaIdFiltro) &&
        (lojasPermitidas === undefined || lojasPermitidas.includes(id))
    );
}

// Gasto de Ads da Shopee não é por venda (vem por dia, no nível da loja
// inteira) — igual ao padrão do Financeiro do Mercado Livre (gastoAdsTotal),
// entra só no total da janela, não em cada linha da tabela. Lojas sem conta
// Shopee conectada simplesmente não entram na soma, sem erro.
export async function obterGastoAdsShopee(
  lojaIdFiltro: number | undefined,
  lojasPermitidas: number[] | undefined,
  dataInicioISO: string,
  dataFimISO: string
): Promise<number> {
  const lojaIds = await listarLojaIdsComShopeeAds(lojaIdFiltro, lojasPermitidas);
  if (lojaIds.length === 0) return 0;

  const startDate = paraDDMMYYYY(dataInicioISO);
  const endDate = paraDDMMYYYY(dataFimISO);

  const totaisPorLoja = await Promise.all(
    lojaIds.map(async (lojaId) => {
      try {
        const data = await chamarApiAssinada<RespostaAdsDiario>(
          lojaId,
          "/api/v2/ads/get_all_cpc_ads_daily_performance",
          { start_date: startDate, end_date: endDate }
        );
        if (data.error) {
          console.error(`[shopee-ads] loja ${lojaId}: ${data.error} ${data.message ?? ""}`);
          return 0;
        }
        return (data.response ?? []).reduce((soma, dia) => soma + (dia.expense ?? 0), 0);
      } catch (err) {
        console.error(`[shopee-ads] loja ${lojaId}:`, err);
        return 0;
      }
    })
  );

  return totaisPorLoja.reduce((soma, v) => soma + v, 0);
}
