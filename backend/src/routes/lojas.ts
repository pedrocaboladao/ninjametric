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
