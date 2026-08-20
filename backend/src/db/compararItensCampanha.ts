import { readFileSync } from "fs";
import { join } from "path";
import { pool } from "./pool";

const PROMOTION_ID = "C-MLB5063778";

async function main() {
  const itensMlReais: string[] = JSON.parse(
    readFileSync(join(__dirname, "data_mes_vigente_ml.json"), "utf-8")
  );
  const setMl = new Set(itensMlReais);

  const { rows } = await pool.query<{ item_id: string }>(
    `SELECT i.item_id FROM promocoes_itens i
     JOIN promocoes_campanhas c ON c.id = i.campanha_id
     WHERE c.promotion_id = $1`,
    [PROMOTION_ID]
  );
  const itensNosso = rows.map((r) => r.item_id);
  const setNosso = new Set(itensNosso);

  console.log(`Itens no export do ML: ${setMl.size}`);
  console.log(`Itens no nosso banco: ${setNosso.size}`);

  const soNoNosso = itensNosso.filter((id) => !setMl.has(id));
  const soNoMl = itensMlReais.filter((id) => !setNosso.has(id));

  console.log(`\nItens que TEMOS mas o ML não listou (${soNoNosso.length}):`);
  console.log(soNoNosso.slice(0, 30).join(", "));
  if (soNoNosso.length > 30) console.log(`... e mais ${soNoNosso.length - 30}`);

  console.log(`\nItens que o ML listou mas NÃO TEMOS (${soNoMl.length}):`);
  console.log(soNoMl.slice(0, 30).join(", "));
  if (soNoMl.length > 30) console.log(`... e mais ${soNoMl.length - 30}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Falha ao comparar:", err);
  process.exit(1);
});
