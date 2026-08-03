import { pool } from "./pool";
import { env } from "../config/env";

const LOJAS = [
  "Hangar",
  "Catedral Impermeabilizantes",
  "Inga Collors",
  "Perpétua",
  "Cores Certas",
  "Mestre do Impermeabilizante",
  "Cidade Canção",
  "Pinta e Constrói",
  "Rosário Express",
  "Comercial Soares Baleeiro",
  "CASG",
  "Palazzo Collors",
  "Modal Tintas",
  "Collor Mix",
  "Lux Collor",
  "Fábrica de Tintas",
];

async function seed() {
  for (const nome of LOJAS) {
    await pool.query(
      "INSERT INTO lojas (nome) VALUES ($1) ON CONFLICT (nome) DO NOTHING",
      [nome]
    );
  }
  console.log("Lojas base inseridas.");

  await pool.query(
    "INSERT INTO usuarios (username, senha_hash, nome, admin) VALUES ($1, $2, $3, true) ON CONFLICT (username) DO NOTHING",
    [env.authUsername, env.authPasswordHash, "Pedro Dantas"]
  );
  console.log("Usuário administrador base garantido.");

  await pool.end();
}

seed().catch((err) => {
  console.error("Falha ao inserir lojas:", err);
  process.exit(1);
});
