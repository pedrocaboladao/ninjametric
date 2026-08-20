import { Router, Request, Response } from "express";
import {
  listarEmbalagens,
  criarEmbalagem,
  atualizarEmbalagem,
  excluirEmbalagem,
  listarEmbalagensDeFormulas,
  ligarEmbalagem,
  ligarAutomaticamentePorPeso,
  type EmbalagemEntrada,
} from "../services/fabricaEmbalagensService";

export const fabricaEmbalagensRouter = Router();

function erro(res: Response, err: unknown, padrao: string) {
  console.error("[fabrica-embalagens]", err);
  res.status(400).json({ error: err instanceof Error && err.message ? err.message : padrao });
}

function numero(v: unknown, minimo = 0): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= minimo ? n : null;
}

function lerEntrada(req: Request): EmbalagemEntrada | string {
  const b = req.body ?? {};
  if (typeof b.nome !== "string" || !b.nome.trim()) return "Informe o nome da embalagem.";
  const pesoKg = numero(b.pesoKg);
  if (pesoKg === null || pesoKg <= 0) return "Peso deve ser maior que zero.";
  const custoUnitario = numero(b.custoUnitario);
  if (custoUnitario === null) return "Custo unitário inválido.";
  const estoque = numero(b.estoque);
  if (estoque === null) return "Estoque inválido.";
  const estoqueMinimo = numero(b.estoqueMinimo);
  if (estoqueMinimo === null) return "Estoque mínimo inválido.";
  return { nome: b.nome.trim(), pesoKg, custoUnitario, estoque, estoqueMinimo, ativo: b.ativo !== false };
}

fabricaEmbalagensRouter.get("/", async (_req, res) => {
  try {
    res.json({ embalagens: await listarEmbalagens() });
  } catch (err) {
    erro(res, err, "Falha ao carregar embalagens.");
  }
});

fabricaEmbalagensRouter.post("/", async (req, res) => {
  const entrada = lerEntrada(req);
  if (typeof entrada === "string") return res.status(400).json({ error: entrada });
  try {
    res.status(201).json(await criarEmbalagem(entrada));
  } catch (err) {
    erro(res, err, "Falha ao criar embalagem.");
  }
});

fabricaEmbalagensRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  const entrada = lerEntrada(req);
  if (typeof entrada === "string") return res.status(400).json({ error: entrada });
  try {
    await atualizarEmbalagem(id, entrada);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao atualizar embalagem.");
  }
});

fabricaEmbalagensRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  try {
    await excluirEmbalagem(id);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao excluir embalagem.");
  }
});

// --- ligação com as embalagens das fórmulas ---

fabricaEmbalagensRouter.get("/formulas/vinculos", async (_req, res) => {
  try {
    res.json({ vinculos: await listarEmbalagensDeFormulas() });
  } catch (err) {
    erro(res, err, "Falha ao carregar vínculos.");
  }
});

fabricaEmbalagensRouter.put("/formulas/vinculos/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  const alvo = req.body?.fabricaEmbalagemId;
  const fabricaEmbalagemId = alvo === null || alvo === undefined || alvo === "" ? null : Number(alvo);
  if (fabricaEmbalagemId !== null && !Number.isInteger(fabricaEmbalagemId)) {
    return res.status(400).json({ error: "Embalagem inválida." });
  }
  try {
    await ligarEmbalagem(id, fabricaEmbalagemId);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao ligar embalagem.");
  }
});

fabricaEmbalagensRouter.post("/formulas/vincular-por-peso", async (_req, res) => {
  try {
    res.json(await ligarAutomaticamentePorPeso());
  } catch (err) {
    erro(res, err, "Falha ao vincular por peso.");
  }
});
