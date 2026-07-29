import fs from "fs";
import path from "path";
import { pool } from "./pool";

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  await pool.query(schema);
  console.log("Migração aplicada com sucesso.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Falha na migração:", err);
  process.exit(1);
});
