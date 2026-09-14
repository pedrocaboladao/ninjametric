import { Router, Response } from "express";
import {
  listarDiscrepancias,
  registrarDiscrepancia,
  excluirDiscrepancia,
  buscarRankingDiscrepancias,
  responderDiscrepancia,
  buscarUltimasVendas,
  buscarPrecoOficial,
  recalcularSkusFaltantes,
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

// Também devolve o preço oficial (SKU master, mesma planilha do Financeiro)
// junto — o frontend já busca isso uma vez por card, não vale fazer duas
// chamadas separadas pra informação que aparece junto na tela.
discrepanciasRouter.get("/ultimas-vendas", async (req, res) => {
  const lojaId = Number(req.query.lojaId);
  const mlb = typeof req.query.mlb === "string" ? req.query.mlb : "";
  const sku = typeof req.query.sku === "string" ? req.query.sku : null;
  if (!Number.isInteger(lojaId) || !mlb) {
    res.status(400).json({ error: "Informe ?lojaId=&mlb=" });
    return;
  }
  try {
    const [vendas, precoOficial] = await Promise.all([
      buscarUltimasVendas(lojaId, mlb),
      buscarPrecoOficial(sku),
    ]);
    res.json({ vendas, precoOficial });
  } catch (err) {
    erro(res, err, "Falha ao buscar as últimas vendas.");
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

// Temporária — corrige de uma vez as linhas cadastradas antes do fallback
// de SKU por variação existir. Rodar uma vez e remover depois.
discrepanciasRouter.post("/recalcular-skus", async (_req, res) => {
  try {
    res.json(await recalcularSkusFaltantes());
  } catch (err) {
    erro(res, err, "Falha ao recalcular SKUs.");
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
