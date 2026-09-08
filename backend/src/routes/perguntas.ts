import { Router } from "express";
import { listarPerguntasPendentes } from "../services/perguntasService";
import { answerQuestion, deleteQuestion } from "../services/mercadoLivreQuestions";
import { temAcessoLoja, lojasEfetivas } from "../services/usuariosService";
import { sugerirResposta, registrarRespostaEnviada } from "../services/perguntasIAService";

export const perguntasRouter = Router();

perguntasRouter.get("/", async (req, res) => {
  try {
    const usuario = req.usuario!;
    const perguntas = await listarPerguntasPendentes(lojasEfetivas(usuario));
    res.json({ perguntas });
  } catch (err) {
    console.error("Erro ao listar perguntas:", err);
    res.status(500).json({ error: "Falha ao carregar perguntas." });
  }
});

perguntasRouter.post("/:lojaId/sugestao", async (req, res) => {
  const lojaId = Number(req.params.lojaId);
  const { perguntaTexto, produtoTitulo } = req.body;
  const usuario = req.usuario!;

  if (!Number.isInteger(lojaId) || typeof perguntaTexto !== "string" || !perguntaTexto.trim()) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  if (!temAcessoLoja(usuario, lojaId)) {
    res.status(403).json({ error: "Você não tem acesso a essa loja." });
    return;
  }

  try {
    const sugestao = await sugerirResposta(lojaId, perguntaTexto, typeof produtoTitulo === "string" ? produtoTitulo : null);
    res.json({ sugestao });
  } catch (err) {
    console.error("Erro ao sugerir resposta:", err);
    res.status(500).json({ error: "Falha ao sugerir resposta." });
  }
});

perguntasRouter.post("/:lojaId/:questionId/responder", async (req, res) => {
  const lojaId = Number(req.params.lojaId);
  const questionId = Number(req.params.questionId);
  const { texto, perguntaTexto, produtoTitulo, respostaSugerida } = req.body;
  const usuario = req.usuario!;

  if (!Number.isInteger(lojaId) || !Number.isInteger(questionId) || typeof texto !== "string" || !texto.trim()) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  if (!temAcessoLoja(usuario, lojaId)) {
    res.status(403).json({ error: "Você não tem acesso a essa loja." });
    return;
  }

  try {
    await answerQuestion(lojaId, questionId, texto.trim());
    res.json({ ok: true });

    // Best-effort: nunca deve derrubar o envio já confirmado acima. Só
    // registra o histórico quando o front manda a pergunta original (telas
    // antigas sem essa info simplesmente não alimentam o histórico).
    if (typeof perguntaTexto === "string" && perguntaTexto.trim()) {
      registrarRespostaEnviada(
        lojaId,
        perguntaTexto,
        typeof produtoTitulo === "string" ? produtoTitulo : null,
        typeof respostaSugerida === "string" ? respostaSugerida : null,
        texto.trim()
      ).catch((err) => console.error("Falha ao registrar histórico de resposta:", err));
    }
  } catch (err) {
    console.error("Erro ao responder pergunta:", err);
    res.status(500).json({ error: "Falha ao responder pergunta." });
  }
});

perguntasRouter.delete("/:lojaId/:questionId", async (req, res) => {
  const lojaId = Number(req.params.lojaId);
  const questionId = Number(req.params.questionId);
  const usuario = req.usuario!;

  if (!Number.isInteger(lojaId) || !Number.isInteger(questionId)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  if (!temAcessoLoja(usuario, lojaId)) {
    res.status(403).json({ error: "Você não tem acesso a essa loja." });
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
