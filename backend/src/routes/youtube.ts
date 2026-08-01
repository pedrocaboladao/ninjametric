import { Router } from "express";
import { adicionarCanal, listarCanais, removerCanal, listarVideosRecentes } from "../services/youtubeService";
import { requireAdmin } from "../middleware/requireAuth";

export const youtubeRouter = Router();

youtubeRouter.get("/canais", async (_req, res) => {
  try {
    const canais = await listarCanais();
    res.json({ canais });
  } catch (err) {
    console.error("Erro ao listar canais do YouTube:", err);
    res.status(500).json({ error: "Falha ao listar canais." });
  }
});

youtubeRouter.post("/canais", requireAdmin, async (req, res) => {
  const { url } = req.body;
  if (typeof url !== "string" || !url.trim()) {
    res.status(400).json({ error: "Informe o link do canal." });
    return;
  }

  try {
    const canal = await adicionarCanal(url);
    res.json({ canal });
  } catch (err) {
    console.error("Erro ao adicionar canal do YouTube:", err);
    const mensagem = err instanceof Error ? err.message : "Falha ao adicionar canal.";
    res.status(500).json({ error: mensagem });
  }
});

youtubeRouter.delete("/canais/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Id inválido." });
    return;
  }

  try {
    await removerCanal(id);
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao remover canal do YouTube:", err);
    res.status(500).json({ error: "Falha ao remover canal." });
  }
});

youtubeRouter.get("/videos", async (_req, res) => {
  try {
    const videos = await listarVideosRecentes();
    res.json({ videos });
  } catch (err) {
    console.error("Erro ao buscar vídeos do YouTube:", err);
    res.status(500).json({ error: "Falha ao buscar vídeos." });
  }
});
