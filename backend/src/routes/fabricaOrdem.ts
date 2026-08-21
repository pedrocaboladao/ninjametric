import { Router, Response } from "express";
import {
  montarOrdem,
  salvarRoteiro,
  formulasComRoteiro,
  type PassoEntrada,
  type LinhaQc,
} from "../services/fabricaOrdemService";

export const fabricaOrdemRouter = Router();

function erro(res: Response, err: unknown, padrao: string) {
  console.error("[fabrica-ordem]", err);
  res.status(400).json({ error: err instanceof Error && err.message ? err.message : padrao });
}

fabricaOrdemRouter.get("/formulas", async (_req, res) => {
  try {
    res.json({ formulas: await formulasComRoteiro() });
  } catch (err) {
    erro(res, err, "Falha ao carregar as fórmulas.");
  }
});

fabricaOrdemRouter.get("/:formulaId", async (req, res) => {
  const formulaId = Number(req.params.formulaId);
  if (!Number.isInteger(formulaId)) return res.status(400).json({ error: "Id inválido." });
  const peso = Number(req.query.peso);
  try {
    const ordem = await montarOrdem(formulaId, Number.isFinite(peso) ? peso : 0);
    if (!ordem) return res.status(404).json({ error: "Fórmula não encontrada." });
    res.json({ ordem });
  } catch (err) {
    erro(res, err, "Falha ao montar a ordem de fabricação.");
  }
});

fabricaOrdemRouter.put("/:formulaId", async (req, res) => {
  const formulaId = Number(req.params.formulaId);
  if (!Number.isInteger(formulaId)) return res.status(400).json({ error: "Id inválido." });
  const b = req.body ?? {};
  if (!Array.isArray(b.passos)) return res.status(400).json({ error: "Passos inválidos." });

  const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const passos: PassoEntrada[] = [];
  for (const bruto of b.passos) {
    const materiaPrimaId = Number.isInteger(Number(bruto?.materiaPrimaId))
      ? Number(bruto.materiaPrimaId)
      : null;
    const subFormulaId = Number.isInteger(Number(bruto?.subFormulaId))
      ? Number(bruto.subFormulaId)
      : null;
    const percentual = Number(bruto?.percentual);
    // passo sem insumo e sem texto não descreve nada: seria uma linha em
    // branco na folha impressa
    if (materiaPrimaId === null && subFormulaId === null && !texto(bruto?.instrucao)) {
      return res.status(400).json({ error: "Passo sem insumo e sem instrução." });
    }
    passos.push({
      materiaPrimaId,
      subFormulaId,
      percentual: Number.isFinite(percentual) ? percentual : null,
      codigo: texto(bruto?.codigo),
      etapa: texto(bruto?.etapa),
      instrucao: texto(bruto?.instrucao),
    });
  }

  const qc: LinhaQc[] = Array.isArray(b.qc)
    ? b.qc
        .filter((l: unknown) => texto((l as { teste?: unknown })?.teste))
        .map((l: { teste: string; especificacao?: unknown }) => ({
          teste: String(l.teste).trim(),
          especificacao: texto(l.especificacao),
        }))
    : [];

  try {
    await salvarRoteiro(formulaId, passos, qc);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao salvar o roteiro.");
  }
});
