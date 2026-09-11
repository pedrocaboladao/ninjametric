import { Router, Response } from "express";
import {
  listarDiscrepancias,
  registrarDiscrepancia,
  excluirDiscrepancia,
  buscarRankingDiscrepancias,
} from "../services/discrepanciasService";

export const discrepanciasRouter = Router();

function erro(res: Response, err: unknown, fallback: string) {
  console.error(fallback, err);
  const mensagem = err instanceof Error ? err.message : fallback;
  res.status(400).json({ error: mensagem });
}

discrepanciasRouter.get("/", async (_req, res) => {
  try {
    res.json({ discrepancias: await listarDiscrepancias() });
  } catch (err) {
    erro(res, err, "Falha ao carregar discrepâncias.");
  }
});

discrepanciasRouter.get("/ranking", async (_req, res) => {
  try {
    res.json(await buscarRankingDiscrepancias());
  } catch (err) {
    erro(res, err, "Falha ao carregar o ranking.");
  }
});

discrepanciasRouter.post("/", async (req, res) => {
  const { link } = req.body ?? {};
  if (typeof link !== "string" || !link.trim()) {
    res.status(400).json({ error: "Cole o link do anúncio." });
    return;
  }
  try {
    const discrepancia = await registrarDiscrepancia(req.usuario!.id, link.trim());
    res.json({ discrepancia });
  } catch (err) {
    erro(res, err, "Falha ao registrar a discrepância.");
  }
});

discrepanciasRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await excluirDiscrepancia(id, req.usuario!.id, req.usuario!.admin);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao excluir.");
  }
});
