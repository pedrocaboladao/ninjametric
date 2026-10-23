import { Router } from "express";
import { obterPainelAds, salvarMeta, MARGEM_MOTOR_PADRAO, MARGEM_ATENCAO_PADRAO, lojasDoPainel } from "../services/adsPainelService";
import { gerarPlanoDeAcaoControleAds } from "../services/controleAdsAcoesService";
import { obterStatusPlano, planoSemLimite } from "../services/controleAdsLimiteService";

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
      ...(await obterPainelAds(inicio, fim, lojasDoPainel(req.usuario!), req.query.atualizar === "1")),
    });
  } catch (err) {
    console.error("Falha ao montar o controle de Ads:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Falha ao montar o controle de Ads." });
  }
});

// Plano de ação por IA, sob demanda (botão na tela) — nunca automático nem
// no auto-refresh, porque cada chamada tem custo real (Opus + thinking).
adsPainelRouter.get("/plano-de-acao/status", async (req, res) => {
  try {
    res.json(await obterStatusPlano(req.usuario!));
  } catch (err) {
    console.error("Falha ao consultar o limite do plano de ação:", err);
    res.status(500).json({ error: "Falha ao consultar o limite do plano de ação." });
  }
});

adsPainelRouter.post("/plano-de-acao", async (req, res) => {
  if (!planoSemLimite(req.usuario!)) {
    res.status(403).json({ error: "Só o dono pode gerar o plano de ação." });
    return;
  }
  const inicio = typeof req.body?.inicio === "string" ? req.body.inicio : "";
  const fim = typeof req.body?.fim === "string" ? req.body.fim : "";
  if (!REGEX_DATA.test(inicio) || !REGEX_DATA.test(fim)) {
    res.status(400).json({ error: "Informe inicio e fim no formato AAAA-MM-DD." });
    return;
  }
  const lojaIdBruto = req.body?.lojaId;
  if (lojaIdBruto !== undefined && (!Number.isInteger(lojaIdBruto) || !lojasDoPainel(req.usuario!).includes(lojaIdBruto))) {
    res.status(400).json({ error: "Loja fora do painel." });
    return;
  }
  const lojaId: number | undefined = lojaIdBruto === undefined ? undefined : lojaIdBruto;
  try {
    const plano = await gerarPlanoDeAcaoControleAds(inicio, fim, lojasDoPainel(req.usuario!), lojaId);
    res.json(plano);
  } catch (err) {
    console.error("Falha ao gerar o plano de ação do Controle de Ads:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Falha ao gerar o plano de ação." });
  }
});

adsPainelRouter.put("/metas/:lojaId", async (req, res) => {
  const lojaId = Number(req.params.lojaId);
  const motorMinimo = Number(req.body?.motorMinimo);
  const atencaoMinimo = Number(req.body?.atencaoMinimo);
  if (!Number.isInteger(lojaId) || !lojasDoPainel(req.usuario!).includes(lojaId)) {
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
