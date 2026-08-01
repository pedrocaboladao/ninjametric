import { Router } from "express";
import axios from "axios";
import { adicionarCanal, listarCanais, removerCanal, listarVideosRecentes } from "../services/youtubeService";

export const youtubeRouter = Router();

// TEMP: checar o que o servidor recebe de verdade ao buscar a duração de um
// vídeo (pra investigar por que a lista está saindo vazia em produção).
youtubeRouter.get("/debug-duracao", async (req, res) => {
  const videoId = String(req.query.id ?? "");
  try {
    const { data: html, status } = await axios.get<string>(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { "User-Agent": "Mozilla/5.0", Cookie: "CONSENT=YES+1" },
    });
    res.json({
      status,
      tamanhoHtml: html.length,
      lengthSeconds: html.match(/"lengthSeconds":"(\d+)"/)?.[1] ?? null,
      pareceConsent: html.toLowerCase().includes("consent"),
      trecho: html.slice(0, 500),
    });
  } catch (err: any) {
    res.json({ erro: err.message, status: err.response?.status, trecho: String(err.response?.data).slice(0, 500) });
  }
});

youtubeRouter.get("/canais", async (_req, res) => {
  try {
    const canais = await listarCanais();
    res.json({ canais });
  } catch (err) {
    console.error("Erro ao listar canais do YouTube:", err);
    res.status(500).json({ error: "Falha ao listar canais." });
  }
});

youtubeRouter.post("/canais", async (req, res) => {
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

youtubeRouter.delete("/canais/:id", async (req, res) => {
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
