import { Router } from "express";
import { criarKeyword, definirAtiva, listarKeywords } from "../services/keywordsService";
import { buscarAgora, calcularMetricas, listarHistorico } from "../services/searchService";

export const marketRouter = Router();

marketRouter.get("/keywords", async (_req, res) => {
  const keywords = await listarKeywords();
  res.json({ keywords });
});

marketRouter.post("/keywords", async (req, res) => {
  const keyword = typeof req.body?.keyword === "string" ? req.body.keyword.trim() : "";
  if (!keyword) {
    res.status(400).json({ error: "Informe uma palavra-chave." });
    return;
  }
  const criada = await criarKeyword(keyword);
  res.json({ keyword: criada });
});

marketRouter.post("/keywords/:id/active", async (req, res) => {
  const id = Number(req.params.id);
  const active = !!req.body?.active;
  await definirAtiva(id, active);
  res.json({ ok: true });
});

marketRouter.post("/keywords/:id/search", async (req, res) => {
  const id = Number(req.params.id);
  try {
    await buscarAgora(id);
    const [historico, metricas] = await Promise.all([listarHistorico(id), calcularMetricas(id)]);
    res.json({ historico, metricas });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Falha ao buscar." });
  }
});

marketRouter.get("/keywords/:id/history", async (req, res) => {
  const id = Number(req.params.id);
  const [historico, metricas] = await Promise.all([listarHistorico(id), calcularMetricas(id)]);
  res.json({ historico, metricas });
});
