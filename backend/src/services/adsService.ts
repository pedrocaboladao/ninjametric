import { listLojas } from "./tokenStore";
import { getAdvertiserId, getCampanhasAds, MlCampanhaAds } from "./mercadoLivreApi";

export interface CampanhaAds {
  lojaId: number;
  lojaNome: string;
  campanhaId: number;
  nome: string;
  status: string;
  orcamento: number;
  acosMeta: number;
  cliques: number;
  impressoes: number;
  custo: number;
  cpc: number;
  vendasDiretas: number;
  vendasIndiretas: number;
  vendasTotais: number;
  acos: number;
}

function mapearCampanha(lojaId: number, lojaNome: string, c: MlCampanhaAds): CampanhaAds {
  return {
    lojaId,
    lojaNome,
    campanhaId: c.id,
    nome: c.name,
    status: c.status,
    orcamento: c.budget,
    acosMeta: c.acos_target,
    cliques: c.metrics.clicks,
    impressoes: c.metrics.prints,
    custo: c.metrics.cost,
    cpc: c.metrics.cpc,
    vendasDiretas: c.metrics.direct_amount,
    vendasIndiretas: c.metrics.indirect_amount,
    vendasTotais: c.metrics.total_amount,
    acos: c.metrics.acos,
  };
}

// Cache curto — mesma lógica do Financeiro: janela de 15 min, com opção de
// forçar (botão "Atualizar" na tela).
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { data: CampanhaAds[]; expiraEm: number }>();

export async function listarCampanhasAds(
  lojaIdFiltro?: number,
  lojasPermitidas?: number[],
  dataInicio?: string,
  dataFim?: string,
  forcarAtualizacao = false
): Promise<CampanhaAds[]> {
  const lojas = (await listLojas()).filter(
    (l) =>
      l.ml_user_id !== null &&
      (lojaIdFiltro === undefined || l.id === lojaIdFiltro) &&
      (lojasPermitidas === undefined || lojasPermitidas.includes(l.id))
  );

  const chaveCache = `${lojas
    .map((l) => l.id)
    .sort((a, b) => a - b)
    .join(",")}|${dataInicio ?? ""}|${dataFim ?? ""}`;
  const emCache = cache.get(chaveCache);
  if (!forcarAtualizacao && emCache && emCache.expiraEm > Date.now()) {
    return emCache.data;
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dateFrom = dataInicio ?? seteDiasAtras;
  const dateTo = dataFim ?? hoje;

  const porLoja = await Promise.all(
    lojas.map(async (loja) => {
      const advertiserId = await getAdvertiserId(loja.id);
      if (advertiserId === null) return [];
      try {
        const campanhas = await getCampanhasAds(loja.id, advertiserId, dateFrom, dateTo);
        return campanhas.map((c) => mapearCampanha(loja.id, loja.nome, c));
      } catch {
        return [];
      }
    })
  );

  const resultado = porLoja.flat();
  cache.set(chaveCache, { data: resultado, expiraEm: Date.now() + CACHE_TTL_MS });
  return resultado;
}
