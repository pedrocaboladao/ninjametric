import { pool } from "./pool";
import { listarOportunidades, compararComVendaReal } from "../services/promocoesOportunidadesService";

async function main() {
  const todas = await listarOportunidades();
  const aprovadas = todas.filter((o) => o.status === "aprovada");

  console.log(`Oportunidades aprovadas: ${aprovadas.length} (de ${todas.length} no total)\n`);

  let comVenda = 0;
  let semVenda = 0;

  for (const o of aprovadas) {
    try {
      const comp = await compararComVendaReal(o.id);
      if (comp.encontrada) {
        comVenda++;
        console.log(
          `✅ ${o.lojaNome} | ${o.titulo ?? o.itemId} | vendeu em ${comp.vendaData} | margem prevista ${comp.percentualMargemPrevista?.toFixed(1)}% vs real ${comp.percentualMargemReal?.toFixed(1)}%`
        );
      } else {
        semVenda++;
      }
    } catch (err) {
      console.log(`Erro em ${o.itemId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\n--- Resumo ---`);
  console.log(`Com venda real desde a aprovação: ${comVenda}`);
  console.log(`Ainda sem venda: ${semVenda}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Falha:", err);
  process.exit(1);
});
