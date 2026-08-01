import { Router } from "express";
import { listarProdutos } from "../services/produtosService";

export const produtosRouter = Router();

produtosRouter.get("/", async (_req, res) => {
  try {
    const produtos = await listarProdutos();
    res.json({ produtos });
  } catch (err) {
    console.error("Erro ao listar produtos:", err);
    res.status(500).json({ error: "Falha ao carregar a planilha de produtos." });
  }
});
