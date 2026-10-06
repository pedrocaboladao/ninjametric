import { Router } from "express";
import { obterPainelAds, salvarMeta, MARGEM_MOTOR_PADRAO, MARGEM_ATENCAO_PADRAO, LOJAS_DO_DONO } from "../services/adsPainelService";

export const adsPainelRouter = Router();

const REGEX_DATA = /^\d{4}-\d{2}-\d{2}$/;
const MAXIMO_DIAS = 366;

adsPainelRouter.get("/", async (req, res) => {
  const inicio = typeof req.query.inicio === "string" ? req.query.inicio : "";
  const fim = typeof req.query.fim === "string" ? req.query.fim : "";
  if (!REGEX_DATA.test(inicio) || !REGEX_DATA.test(fim)) {
    res.status(400).json({ error: "Informe inicio e fim no formato AAAA-MM-DD." });
    return;
  }
  const dias = (Date.parse(fim) - Date.parse(inicio)) / 86400000 + 1;
  if (!(dias >= 1) || dias > MAXIMO_DIAS) {
    res.status(400).json({ error: `O período precisa ter entre 1 e ${MAXIMO_DIAS} dias.` });
    return;
  }
  try {
    res.json({
      metaPadrao: { motorMinimo: MARGEM_MOTOR_PADRAO, atencaoMinimo: MARGEM_ATENCAO_PADRAO },
      ...(await obterPainelAds(inicio, fim)),
    });
  } catch (err) {
    console.error("Falha ao montar o controle de Ads:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Falha ao montar o controle de Ads." });
  }
});

adsPainelRouter.put("/metas/:lojaId", async (req, res) => {
  const lojaId = Number(req.params.lojaId);
  const motorMinimo = Number(req.body?.motorMinimo);
  const atencaoMinimo = Number(req.body?.atencaoMinimo);
  if (!Number.isInteger(lojaId) || !LOJAS_DO_DONO.includes(lojaId)) {
    res.status(400).json({ error: "Loja fora do painel." });
    return;
  }
  if (!Number.isFinite(motorMinimo) || !Number.isFinite(atencaoMinimo)) {
    res.status(400).json({ error: "Informe motorMinimo e atencaoMinimo como números." });
    return;
  }
  try {
    await salvarMeta(lojaId, motorMinimo, atencaoMinimo);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Falha ao salvar a meta." });
  }
});
