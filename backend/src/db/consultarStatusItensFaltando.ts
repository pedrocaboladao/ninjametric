import { pool } from "./pool";
import { listLojas } from "../services/tokenStore";
import { consultarPromocoesDoItem } from "../services/mercadoLivreApi";

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

  for (const itemId of ITENS_FALTANDO) {
    try {
      const promocoes = await consultarPromocoesDoItem(loja.id, itemId);
      console.log(`${itemId}: ${JSON.stringify(promocoes)}`);
    } catch (err) {
      console.log(`${itemId}: erro (${err instanceof Error ? err.message : err})`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Falha:", err);
  process.exit(1);
});
