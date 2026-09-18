import { Router } from "express";
import {
  listarUsuariosParaConversa,
  listarConversas,
  contarNaoLidas,
  listarMensagens,
  enviarMensagem,
} from "../services/mensagensService";

export const mensagensRouter = Router();

function erro(res: import("express").Response, err: unknown, fallback: string) {
  console.error(fallback, err);
  const mensagem = err instanceof Error ? err.message : fallback;
  res.status(400).json({ error: mensagem });
}

mensagensRouter.get("/usuarios", async (req, res) => {
  try {
    res.json({ usuarios: await listarUsuariosParaConversa(req.usuario!.id) });
  } catch (err) {
    erro(res, err, "Falha ao listar usuários.");
  }
});

mensagensRouter.get("/nao-lidas", async (req, res) => {
  try {
    res.json({ total: await contarNaoLidas(req.usuario!.id) });
  } catch (err) {
    erro(res, err, "Falha ao contar mensagens não lidas.");
  }
});

mensagensRouter.get("/", async (req, res) => {
  try {
    res.json({ conversas: await listarConversas(req.usuario!.id) });
  } catch (err) {
    erro(res, err, "Falha ao listar conversas.");
  }
});

mensagensRouter.get("/:outroUsuarioId", async (req, res) => {
  const outroUsuarioId = Number(req.params.outroUsuarioId);
  if (!Number.isInteger(outroUsuarioId)) {
    res.status(400).json({ error: "Usuário inválido." });
    return;
  }
  try {
    res.json({ mensagens: await listarMensagens(req.usuario!.id, outroUsuarioId) });
  } catch (err) {
    erro(res, err, "Falha ao carregar a conversa.");
  }
});

mensagensRouter.post("/:outroUsuarioId", async (req, res) => {
  const outroUsuarioId = Number(req.params.outroUsuarioId);
  const { texto } = req.body ?? {};
  if (!Number.isInteger(outroUsuarioId) || typeof texto !== "string" || !texto.trim()) {
    res.status(400).json({ error: "Informe o texto da mensagem." });
    return;
  }
  try {
    res.json(await enviarMensagem(req.usuario!.id, outroUsuarioId, texto.trim()));
  } catch (err) {
    erro(res, err, "Falha ao enviar mensagem.");
  }
});
