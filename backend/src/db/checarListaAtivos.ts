import { pool } from "./pool";
import { listLojas } from "../services/tokenStore";
import { listarItensAtivos } from "../services/mercadoLivreApi";

const ITENS_FALTANDO = [
  "MLB4735734111", "MLB4746535399", "MLB4795062805", "MLB4801514301",
  "MLB4829040791", "MLB4841887075", "MLB4888326625", "MLB6902635668",
  "MLB6910540520", "MLB6917903114", "MLB6918811730", "MLB6954899454",
  "MLB7071120288", "MLB7170489724", "MLB7203092034", "MLB7408246110",
];

async function main() {
  const lojas = await listLojas();
  const loja = lojas.find((l) => l.nome === "Catedral Impermeabilizantes");
  if (!loja || !loja.ml_user_id) {
    console.log("Loja não encontrada ou sem ml_user_id.");
    await pool.end();
    return;
  }

  const itemIds = await listarItensAtivos(loja.id, loja.ml_user_id);
  const set = new Set(itemIds);
  console.log(`Total de itens ativos retornados agora: ${itemIds.length}`);

  const presentes = ITENS_FALTANDO.filter((id) => set.has(id));
  const ausentes = ITENS_FALTANDO.filter((id) => !set.has(id));
  console.log(`Dos 16 que faltavam: ${presentes.length} apareceram na lista agora, ${ausentes.length} continuam ausentes.`);
  if (ausentes.length > 0) console.log("Ausentes:", ausentes.join(", "));

  await pool.end();
}

main().catch((err) => {
  console.error("Falha:", err);
  process.exit(1);
});
