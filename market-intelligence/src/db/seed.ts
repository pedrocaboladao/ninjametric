import { pool } from "./pool";

const KEYWORDS_EXEMPLO = [
  "manta líquida 18kg",
  "tinta emborrachada",
  "tinta para piso",
  "impermeabilizante",
  "resina para pedra",
  "fundo preparador",
];

async function seed() {
  for (const keyword of KEYWORDS_EXEMPLO) {
    await pool.query("INSERT INTO keywords (keyword) VALUES ($1) ON CONFLICT (keyword) DO NOTHING", [keyword]);
  }
  console.log("Keywords de exemplo inseridas.");
  await pool.end();
}

seed().catch((err) => {
  console.error("Falha ao inserir keywords:", err);
  process.exit(1);
});
