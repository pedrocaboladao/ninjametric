import { Router, Response } from "express";
import {
  listarQuadro,
  criarColuna,
  renomearColuna,
  excluirColuna,
  mudarCorColuna,
  criarCartao,
  atualizarCartao,
  reindexarColuna,
  excluirCartao,
  arquivarTodosConcluidos,
  listarArquivados,
  restaurarCartao,
} from "../services/tarefasService";

const REGEX_COR_HEX = /^#[0-9a-fA-F]{6}$/;

export const tarefasRouter = Router();

function erro(res: Response, err: unknown, fallback: string) {
  console.error(fallback, err);
  const mensagem = err instanceof Error ? err.message : fallback;
  res.status(400).json({ error: mensagem });
}

tarefasRouter.get("/quadro", async (_req, res) => {
  try {
    res.json({ colunas: await listarQuadro() });
  } catch (err) {
    erro(res, err, "Falha ao carregar quadro de tarefas.");
  }
});

tarefasRouter.post("/colunas", async (req, res) => {
  const { nome } = req.body;
  if (typeof nome !== "string" || !nome.trim()) {
    res.status(400).json({ error: "Informe o nome da coluna." });
    return;
  }
  try {
    res.json(await criarColuna(nome.trim()));
  } catch (err) {
    erro(res, err, "Falha ao criar coluna.");
  }
});

tarefasRouter.patch("/colunas/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { nome, cor } = req.body;
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  if (cor !== undefined && cor !== null && !REGEX_COR_HEX.test(cor)) {
    res.status(400).json({ error: "Cor inválida." });
    return;
  }
  try {
    if (nome !== undefined) {
      if (typeof nome !== "string" || !nome.trim()) {
        res.status(400).json({ error: "Informe o nome da coluna." });
        return;
      }
      await renomearColuna(id, nome.trim());
    }
    if (cor !== undefined) {
      await mudarCorColuna(id, cor);
    }
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao atualizar coluna.");
  }
});

tarefasRouter.delete("/colunas/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await excluirColuna(id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao excluir coluna.");
  }
});

tarefasRouter.post("/cartoes", async (req, res) => {
  const { colunaId, titulo } = req.body;
  if (!Number.isInteger(colunaId) || typeof titulo !== "string" || !titulo.trim()) {
    res.status(400).json({ error: "Informe a coluna e o título do cartão." });
    return;
  }
  try {
    res.json(await criarCartao(colunaId, titulo.trim()));
  } catch (err) {
    erro(res, err, "Falha ao criar cartão.");
  }
});

tarefasRouter.patch("/cartoes/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await atualizarCartao(id, req.body ?? {});
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao atualizar cartão.");
  }
});

tarefasRouter.delete("/cartoes/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await excluirCartao(id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao excluir cartão.");
  }
});

tarefasRouter.post("/colunas/:id/reindexar", async (req, res) => {
  const colunaId = Number(req.params.id);
  const { ids } = req.body;
  if (!Number.isInteger(colunaId) || !Array.isArray(ids)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await reindexarColuna(colunaId, ids);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao reordenar coluna.");
  }
});

tarefasRouter.post("/concluidos/arquivar", async (_req, res) => {
  try {
    await arquivarTodosConcluidos();
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao arquivar concluídos.");
  }
});

tarefasRouter.get("/arquivados", async (_req, res) => {
  try {
    res.json({ cartoes: await listarArquivados() });
  } catch (err) {
    erro(res, err, "Falha ao carregar arquivados.");
  }
});

tarefasRouter.post("/cartoes/:id/restaurar", async (req, res) => {
  const id = Number(req.params.id);
  const { colunaId } = req.body;
  if (!Number.isInteger(id) || !Number.isInteger(colunaId)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await restaurarCartao(id, colunaId);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao restaurar cartão.");
  }
});
