import { Router, Response } from "express";
import {
  listarDiscrepancias,
  registrarDiscrepancia,
  excluirDiscrepancia,
  buscarRankingDiscrepancias,
  responderDiscrepancia,
  buscarMargemUltimaVenda,
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

discrepanciasRouter.get("/margem-ultima-venda", async (req, res) => {
  const lojaId = Number(req.query.lojaId);
  const mlb = typeof req.query.mlb === "string" ? req.query.mlb : "";
  if (!Number.isInteger(lojaId) || !mlb) {
    res.status(400).json({ error: "Informe ?lojaId=&mlb=" });
    return;
  }
  try {
    res.json(await buscarMargemUltimaVenda(lojaId, mlb));
  } catch (err) {
    erro(res, err, "Falha ao buscar a margem da última venda.");
  }
});

discrepanciasRouter.patch("/:id/resposta", async (req, res) => {
  const id = Number(req.params.id);
  const { resposta } = req.body ?? {};
  if (!Number.isInteger(id) || typeof resposta !== "string") {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await responderDiscrepancia(id, resposta.trim());
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao salvar a resposta.");
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
