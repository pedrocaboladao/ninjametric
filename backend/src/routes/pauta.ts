import { Router, Response } from "express";
import {
  listarItens,
  criarItem,
  apoiar,
  desapoiar,
  selecionarParaReuniao,
  marcarDiscutido,
  adiarItem,
  obterDonoEStatus,
  excluirItem,
} from "../services/pautaService";

export const pautaRouter = Router();

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function erro(res: Response, err: unknown, fallback: string) {
  console.error(fallback, err);
  const mensagem = err instanceof Error ? err.message : fallback;
  res.status(400).json({ error: mensagem });
}

pautaRouter.get("/", async (req, res) => {
  try {
    res.json({ itens: await listarItens(req.usuario!.id) });
  } catch (err) {
    erro(res, err, "Falha ao carregar a pauta.");
  }
});

pautaRouter.post("/", async (req, res) => {
  const { titulo, descricao, lojaId, area } = req.body;
  if (typeof titulo !== "string" || !titulo.trim()) {
    res.status(400).json({ error: "Informe o título do item." });
    return;
  }
  if (lojaId !== undefined && lojaId !== null && !Number.isInteger(lojaId)) {
    res.status(400).json({ error: "lojaId inválido." });
    return;
  }
  try {
    res.json(
      await criarItem(
        req.usuario!.id,
        titulo.trim(),
        typeof descricao === "string" && descricao.trim() ? descricao.trim() : null,
        lojaId ?? null,
        typeof area === "string" && area.trim() ? area.trim() : null
      )
    );
  } catch (err) {
    erro(res, err, "Falha ao criar item de pauta.");
  }
});

pautaRouter.post("/:id/apoiar", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await apoiar(req.usuario!.id, id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao apoiar item.");
  }
});

pautaRouter.delete("/:id/apoiar", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await desapoiar(req.usuario!.id, id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao remover apoio.");
  }
});

// As três ações abaixo (selecionar pra reunião, marcar discutido, adiar) só o
// diretor (admin) pode fazer — a curadoria do que vira pauta oficial fica
// centralizada, senão a lista de "selecionados" vira bagunça.
pautaRouter.post("/:id/selecionar", async (req, res) => {
  const id = Number(req.params.id);
  const { reuniaoData } = req.body;
  if (!req.usuario!.admin) {
    res.status(403).json({ error: "Só o diretor pode selecionar itens pra pauta da reunião." });
    return;
  }
  if (!Number.isInteger(id) || typeof reuniaoData !== "string" || !DATA_REGEX.test(reuniaoData)) {
    res.status(400).json({ error: "Informe uma data de reunião válida (AAAA-MM-DD)." });
    return;
  }
  try {
    await selecionarParaReuniao(id, reuniaoData);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao selecionar item pra reunião.");
  }
});

pautaRouter.post("/:id/discutido", async (req, res) => {
  const id = Number(req.params.id);
  const { decisao } = req.body;
  if (!req.usuario!.admin) {
    res.status(403).json({ error: "Só o diretor pode marcar um item como discutido." });
    return;
  }
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await marcarDiscutido(id, typeof decisao === "string" && decisao.trim() ? decisao.trim() : null);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao marcar item como discutido.");
  }
});

pautaRouter.post("/:id/adiar", async (req, res) => {
  const id = Number(req.params.id);
  if (!req.usuario!.admin) {
    res.status(403).json({ error: "Só o diretor pode adiar um item." });
    return;
  }
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await adiarItem(id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao adiar item.");
  }
});

pautaRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    const dono = await obterDonoEStatus(id);
    if (!dono) {
      res.status(404).json({ error: "Item não encontrado." });
      return;
    }
    const usuario = req.usuario!;
    const podeExcluir = usuario.admin || (dono.criadoPor === usuario.id && dono.status === "sugerido");
    if (!podeExcluir) {
      res.status(403).json({ error: "Só é possível excluir sugestões próprias ainda não selecionadas." });
      return;
    }
    await excluirItem(id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao excluir item.");
  }
});
