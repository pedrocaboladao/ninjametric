import { Router } from "express";
import { listLojas } from "../services/tokenStore";

export const lojasRouter = Router();

lojasRouter.get("/", async (_req, res) => {
  try {
    const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null);
    res.json({ lojas: lojas.map((l) => ({ id: l.id, nome: l.nome })) });
  } catch (err) {
    console.error("Erro ao listar lojas:", err);
    res.status(500).json({ error: "Falha ao listar lojas." });
  }
});

// Lista todas as lojas cadastradas, incluindo as que ainda não autorizaram o
// Mercado Livre — usado para descobrir o id de uma loja recém-criada e montar
// o link de autorização (/auth/:lojaId/authorize).
lojasRouter.get("/todas", async (_req, res) => {
  try {
    const lojas = await listLojas();
    res.json({ lojas: lojas.map((l) => ({ id: l.id, nome: l.nome, autorizada: l.ml_user_id !== null })) });
  } catch (err) {
    console.error("Erro ao listar lojas:", err);
    res.status(500).json({ error: "Falha ao listar lojas." });
  }
});
