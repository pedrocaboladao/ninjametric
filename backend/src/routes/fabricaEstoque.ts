import { Router, Response } from "express";
import {
  listarEstoque,
  definirEstoqueMinimo,
  listarAjustes,
  registrarAjuste,
  registrarInventario,
  excluirAjuste,
  capacidadeDeProducao,
} from "../services/fabricaEstoqueService";

export const fabricaEstoqueRouter = Router();

function erro(res: Response, err: unknown, padrao: string) {
  console.error("[fabrica-estoque]", err);
  res.status(400).json({ error: err instanceof Error && err.message ? err.message : padrao });
}

fabricaEstoqueRouter.get("/", async (_req, res) => {
  try {
    res.json({ estoque: await listarEstoque() });
  } catch (err) {
    erro(res, err, "Falha ao carregar estoque.");
  }
});

fabricaEstoqueRouter.get("/capacidade", async (_req, res) => {
  try {
    res.json({ capacidade: await capacidadeDeProducao() });
  } catch (err) {
    erro(res, err, "Falha ao calcular capacidade de produção.");
  }
});

fabricaEstoqueRouter.put("/:id/minimo", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  const minimo = Number(req.body?.estoqueMinimo);
  if (!Number.isFinite(minimo) || minimo < 0) {
    return res.status(400).json({ error: "Estoque mínimo inválido." });
  }
  try {
    await definirEstoqueMinimo(id, minimo);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao definir estoque mínimo.");
  }
});

fabricaEstoqueRouter.get("/ajustes", async (_req, res) => {
  try {
    res.json({ ajustes: await listarAjustes() });
  } catch (err) {
    erro(res, err, "Falha ao carregar ajustes.");
  }
});

fabricaEstoqueRouter.post("/ajustes", async (req, res) => {
  const materiaPrimaId = Number(req.body?.materiaPrimaId);
  if (!Number.isInteger(materiaPrimaId)) {
    return res.status(400).json({ error: "Escolha a matéria-prima." });
  }
  const motivo = typeof req.body?.motivo === "string" && req.body.motivo.trim() ? req.body.motivo.trim() : null;
  try {
    // inventário: o operador diz quanto TEM; ajuste: quanto entra ou sai
    if (req.body?.tipo === "inventario") {
      const contado = Number(req.body?.contadoKg);
      if (!Number.isFinite(contado) || contado < 0) {
        return res.status(400).json({ error: "Quantidade contada inválida." });
      }
      return res.status(201).json(await registrarInventario(materiaPrimaId, contado, motivo));
    }
    const quantidade = Number(req.body?.quantidadeKg);
    if (!Number.isFinite(quantidade) || quantidade === 0) {
      return res.status(400).json({ error: "Informe a quantidade (positiva entra, negativa sai)." });
    }
    res.status(201).json(await registrarAjuste(materiaPrimaId, quantidade, motivo));
  } catch (err) {
    erro(res, err, "Falha ao registrar ajuste.");
  }
});

fabricaEstoqueRouter.delete("/ajustes/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  try {
    await excluirAjuste(id);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao excluir ajuste.");
  }
});
