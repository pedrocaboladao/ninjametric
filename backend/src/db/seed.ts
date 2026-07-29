import { pool } from "./pool";
import { env } from "../config/env";

const LOJAS = [
  "Hangar",
  "Catedral Impermeabilizantes",
  "Inga Collors",
  "Perpétua",
  "Cores Certas",
  "Mestre do Impermeabilizante",
];

const COLUNAS_PADRAO = ["Em andamento", "Hangar", "Catedral Impermeabilizantes", "Inga Collors", "Perpétua"];

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

  const { rows } = await pool.query("SELECT COUNT(*)::int AS total FROM tarefas_colunas");
  if (rows[0].total === 0) {
    for (let i = 0; i < COLUNAS_PADRAO.length; i++) {
      await pool.query("INSERT INTO tarefas_colunas (nome, ordem) VALUES ($1, $2)", [COLUNAS_PADRAO[i], i]);
    }
    await pool.query(
      "INSERT INTO tarefas_colunas (nome, especial, ordem) VALUES ('Concluídos', 'concluidos', $1) ON CONFLICT (especial) WHERE especial IS NOT NULL DO NOTHING",
      [COLUNAS_PADRAO.length]
    );
    console.log("Colunas padrão do quadro de tarefas inseridas.");
  }

  await pool.end();
}

seed().catch((err) => {
  console.error("Falha ao inserir lojas:", err);
  process.exit(1);
});
