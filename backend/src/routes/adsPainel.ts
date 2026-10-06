import { Router } from "express";
import { obterPainelAds, ACOS_MOTOR_ATE, ACOS_ATENCAO_ATE } from "../services/adsPainelService";

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
      inicio,
      fim,
      limites: { motorAte: ACOS_MOTOR_ATE, atencaoAte: ACOS_ATENCAO_ATE },
      contas: await obterPainelAds(inicio, fim),
    });
  } catch (err) {
    console.error("Falha ao montar o painel de Ads:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Falha ao montar o painel de Ads." });
  }
});
