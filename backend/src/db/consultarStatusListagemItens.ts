import { pool } from "./pool";
import { listLojas } from "../services/tokenStore";
import { getItemsBasicInfo, listarItensAtivos } from "../services/mercadoLivreApi";

const ITENS_FALTANDO = [
  "MLB4735734111", "MLB4746535399", "MLB4795062805", "MLB4801514301",
  "MLB4829040791", "MLB4841887075", "MLB4888326625", "MLB6902635668",
  "MLB6910540520", "MLB6917903114", "MLB6918811730", "MLB6954899454",
  "MLB7071120288", "MLB7170489724", "MLB7203092034", "MLB7408246110",
];

async function main() {
  const lojas = await listLojas();
  const loja = lojas.find((l) => l.nome === "Catedral Impermeabilizantes");
  if (!loja) {
    console.log("Loja não encontrada.");
    await pool.end();
    return;
  }

  if (!loja.ml_user_id) {
    console.log("Loja sem ml_user_id.");
    await pool.end();
    return;
  }

  function linha(itemId: string, info: ReturnType<Map<string, any>["get"]>): string {
    return info
      ? `${itemId}: status=${info.status} catalog_listing=${info.catalog_listing} listing_type_id=${info.listing_type_id} category_id=${info.category_id} title=${info.title}`
      : `${itemId}: não retornado pela API (talvez 404/closed)`;
  }

  console.log("--- Itens que FALTAM (ausentes da varredura) ---");
  const infosFaltando = await getItemsBasicInfo(loja.id, ITENS_FALTANDO);
  for (const itemId of ITENS_FALTANDO) {
    console.log(linha(itemId, infosFaltando.get(itemId)));
  }

  console.log("\n--- Amostra de itens que APARECEM na varredura (pra comparar) ---");
  const itensAtivos = await listarItensAtivos(loja.id, loja.ml_user_id);
  const amostra = itensAtivos.slice(0, 8);
  const infosAmostra = await getItemsBasicInfo(loja.id, amostra);
  for (const itemId of amostra) {
    console.log(linha(itemId, infosAmostra.get(itemId)));
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Falha:", err);
  process.exit(1);
});
