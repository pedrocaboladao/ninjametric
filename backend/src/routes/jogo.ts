import { Router, Response } from "express";
import { obterSemanaJogo, registrarTentativaJogo } from "../services/jogoService";

export const jogoRouter = Router();

function erro(res: Response, err: unknown, fallback: string) {
  console.error(fallback, err);
  const mensagem = err instanceof Error ? err.message : fallback;
  res.status(400).json({ error: mensagem });
}

jogoRouter.get("/semana", async (req, res) => {
  try {
    res.json(await obterSemanaJogo(req.usuario!.id));
  } catch (err) {
    erro(res, err, "Falha ao carregar o jogo da semana.");
  }
});

jogoRouter.post("/tentativa", async (req, res) => {
  const pontuacao = Number(req.body?.pontuacao);
  if (!Number.isFinite(pontuacao)) {
    res.status(400).json({ error: "Informe a pontuação." });
    return;
  }
  try {
    res.json(await registrarTentativaJogo(req.usuario!.id, Math.round(pontuacao)));
  } catch (err) {
    erro(res, err, "Falha ao registrar a tentativa.");
  }
});
