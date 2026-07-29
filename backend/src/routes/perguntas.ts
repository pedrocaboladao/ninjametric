import { Router } from "express";
import { listarPerguntasPendentes } from "../services/perguntasService";
import { answerQuestion, deleteQuestion } from "../services/mercadoLivreQuestions";

export const perguntasRouter = Router();

perguntasRouter.get("/", async (_req, res) => {
  try {
    const perguntas = await listarPerguntasPendentes();
    res.json({ perguntas });
  } catch (err) {
    console.error("Erro ao listar perguntas:", err);
    res.status(500).json({ error: "Falha ao carregar perguntas." });
  }
});

perguntasRouter.post("/:lojaId/:questionId/responder", async (req, res) => {
  const lojaId = Number(req.params.lojaId);
  const questionId = Number(req.params.questionId);
  const { texto } = req.body;

  if (!Number.isInteger(lojaId) || !Number.isInteger(questionId) || typeof texto !== "string" || !texto.trim()) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }

  try {
    await answerQuestion(lojaId, questionId, texto.trim());
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao responder pergunta:", err);
    res.status(500).json({ error: "Falha ao responder pergunta." });
  }
});

perguntasRouter.delete("/:lojaId/:questionId", async (req, res) => {
  const lojaId = Number(req.params.lojaId);
  const questionId = Number(req.params.questionId);

  if (!Number.isInteger(lojaId) || !Number.isInteger(questionId)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }

  try {
    await deleteQuestion(lojaId, questionId);
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao excluir pergunta:", err);
    res.status(500).json({ error: "Falha ao excluir pergunta." });
  }
});
