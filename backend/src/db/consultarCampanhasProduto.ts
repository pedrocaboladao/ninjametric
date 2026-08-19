import { pool } from "./pool";
import { listLojas } from "../services/tokenStore";
import { getAdvertiserId, getAnunciosAds } from "../services/mercadoLivreApi";

const TERMOS = ["resiflex", "18"];
const DIAS = 30;

function contemTermos(titulo: string): boolean {
  const t = titulo.toLowerCase();
  return TERMOS.every((termo) => t.includes(termo));
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

  console.log(`Buscando anúncios de "${TERMOS.join(" + ")}" em Ads, últimos ${DIAS} dias (${dataInicio} a ${dataFim})\n`);

  let totalCliques = 0;
  let totalCusto = 0;
  let totalVendas = 0;
  let encontrados = 0;

  for (const loja of lojas) {
    try {
      const advertiserId = await getAdvertiserId(loja.id);
      if (!advertiserId) {
        console.log(`${loja.nome}: sem advertiser Ads configurado, pulando.`);
        continue;
      }
      const anuncios = await getAnunciosAds(loja.id, advertiserId, dataInicio, dataFim);
      const filtrados = anuncios.filter((a) => contemTermos(a.title));
      if (filtrados.length === 0) {
        console.log(`${loja.nome}: nenhum anúncio de RESIFLEX 18KG em Ads no período.`);
        continue;
      }
      console.log(`${loja.nome}:`);
      for (const a of filtrados) {
        encontrados++;
        totalCliques += a.metrics.clicks;
        totalCusto += a.metrics.cost;
        totalVendas += a.metrics.total_amount;
        console.log(
          `  - ${a.title} | status=${a.status} | cliques=${a.metrics.clicks} | custo=R$${a.metrics.cost.toFixed(2)} | ACOS=${a.metrics.acos.toFixed(1)}% | vendas=R$${a.metrics.total_amount.toFixed(2)}`
        );
      }
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
