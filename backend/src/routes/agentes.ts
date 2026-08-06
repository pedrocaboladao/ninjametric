import { Router, Response } from "express";
import { verificarAgenteAds, listarObservacoes, confirmarObservacao, listarPensamentos } from "../services/agenteAdsService";

export const agentesRouter = Router();

function erro(res: Response, err: unknown, fallback: string) {
  console.error(fallback, err);
  const mensagem = err instanceof Error ? err.message : fallback;
  res.status(400).json({ error: mensagem });
}

agentesRouter.get("/ads/feed", async (req, res) => {
  const status = req.query.status;
  const statusValido = status === "pendente" || status === "resolvida" ? status : undefined;
  try {
    res.json({ observacoes: await listarObservacoes(statusValido) });
  } catch (err) {
    erro(res, err, "Falha ao carregar observações.");
  }
});

agentesRouter.get("/ads/pensamentos", async (_req, res) => {
  try {
    res.json({ pensamentos: await listarPensamentos() });
  } catch (err) {
    erro(res, err, "Falha ao carregar pensamentos.");
  }
});

agentesRouter.post("/ads/verificar", async (_req, res) => {
  try {
    res.json(await verificarAgenteAds());
  } catch (err) {
    erro(res, err, "Falha ao verificar.");
  }
});

agentesRouter.post("/ads/:id/confirmar", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await confirmarObservacao(id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao confirmar observação.");
  }
});
