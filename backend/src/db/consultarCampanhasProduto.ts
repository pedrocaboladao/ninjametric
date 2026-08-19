import { pool } from "./pool";
import { listLojas } from "../services/tokenStore";
import { getAdvertiserId, getAnunciosAds, getItemsBasicInfo } from "../services/mercadoLivreApi";
import { normalizarSku } from "../services/financeiroService";

const TERMOS_SKU = ["resiflex", "18kg"];
const DIAS = 30;

function skuBate(sku: string | null): boolean {
  if (!sku) return false;
  const s = normalizarSku(sku);
  return TERMOS_SKU.every((termo) => s.includes(termo));
}

function isoDeNDiasAtras(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null);
  const dataFim = isoDeNDiasAtras(0);
  const dataInicio = isoDeNDiasAtras(DIAS);

  console.log(`Buscando anúncios com SKU "${TERMOS_SKU.join(" + ")}" em Ads, últimos ${DIAS} dias (${dataInicio} a ${dataFim})\n`);

  let totalCliques = 0;
  let totalCusto = 0;
  let totalVendas = 0;
  let encontrados = 0;

  for (const loja of lojas) {
    try {
      const advertiserId = await getAdvertiserId(loja.id);
      if (!advertiserId) continue;

      const anuncios = await getAnunciosAds(loja.id, advertiserId, dataInicio, dataFim);
      if (anuncios.length === 0) continue;

      const itensInfo = await getItemsBasicInfo(loja.id, anuncios.map((a) => a.item_id));
      const filtrados = anuncios.filter((a) => skuBate(itensInfo.get(a.item_id)?.seller_custom_field ?? null));
      if (filtrados.length === 0) continue;

      const cliques = filtrados.reduce((s, a) => s + a.metrics.clicks, 0);
      const custo = filtrados.reduce((s, a) => s + a.metrics.cost, 0);
      const vendas = filtrados.reduce((s, a) => s + a.metrics.total_amount, 0);
      const acos = vendas > 0 ? (custo / vendas) * 100 : 0;
      encontrados += filtrados.length;
      totalCliques += cliques;
      totalCusto += custo;
      totalVendas += vendas;

      const skusEncontrados = filtrados.map((a) => itensInfo.get(a.item_id)?.seller_custom_field).join(", ");
      console.log(
        `${loja.nome} (${filtrados.length} anúncio${filtrados.length > 1 ? "s" : ""} — SKU: ${skusEncontrados}): cliques=${cliques} | custo=R$${custo.toFixed(2)} | ACOS=${acos.toFixed(1)}% | vendas=R$${vendas.toFixed(2)}`
      );
    } catch (err) {
      console.log(`${loja.nome}: erro ao consultar (${err instanceof Error ? err.message : err})`);
    }
  }

  console.log(`\n--- Total do grupo (${encontrados} anúncios) ---`);
  console.log(`Cliques: ${totalCliques}`);
  console.log(`Custo: R$${totalCusto.toFixed(2)}`);
  console.log(`Vendas via Ads: R$${totalVendas.toFixed(2)}`);
  console.log(`ACOS médio: ${totalVendas > 0 ? ((totalCusto / totalVendas) * 100).toFixed(1) : "0.0"}%`);

  await pool.end();
}

main().catch((err) => {
  console.error("Falha ao consultar campanhas:", err);
  process.exit(1);
});
