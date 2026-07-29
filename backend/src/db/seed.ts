import { pool } from "./pool";

const LOJAS = ["Hangar", "Catedral Impermeabilizantes", "Inga Collors", "Perpétua"];

async function seed() {
  for (const nome of LOJAS) {
    await pool.query(
      "INSERT INTO lojas (nome) VALUES ($1) ON CONFLICT (nome) DO NOTHING",
      [nome]
    );
  }
  console.log("Lojas base inseridas.");
  await pool.end();
}

seed().catch((err) => {
  console.error("Falha ao inserir lojas:", err);
  process.exit(1);
});
