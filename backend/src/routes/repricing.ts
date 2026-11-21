import { Router, Request, Response } from "express";
import { listLojas } from "../services/tokenStore";
import { temAcessoLoja } from "../services/usuariosService";
import {
  LOJAS_REPRICING,
  obterPainel,
  obterPainelPromocoes,
  salvarConfig,
  sincronizarLoja,
  ligarRobo,
  desligarRobo,
  alternarRoboEmMassa,
  salvarAjustesItem,
  buscarPromocoesAgora,
  entrarNasPromocoesComMargem,
} from "../services/repricingService";

export const repricingRouter = Router();

const MAX_ITENS_EM_MASSA = 200;
// Clique manual em "Entrar agora": teto bem acima da rodada automática, mas
// ainda finito pra requisição não ficar aberta por tempo indefinido.
const MAX_PROMOCOES_POR_CLIQUE = 150;

function erro(res: Response, err: unknown, fallback: string) {
  console.error(fallback, err);
  const mensagem = err instanceof Error ? err.message : fallback;
  res.status(400).json({ error: mensagem });
}

// O Repricing não tem "todas"/"minhas": cada chamada vale pra uma loja só, e
// só pras lojas liberadas no teste (LOJAS_REPRICING).
function resolverLoja(req: Request, res: Response, bruto: unknown): number | null {
  const lojaId = Number(bruto);
  if (!Number.isInteger(lojaId) || !LOJAS_REPRICING.includes(lojaId)) {
    res.status(400).json({ error: "O Repricing ainda não está liberado pra essa loja." });
    return null;
  }
  if (!temAcessoLoja(req.usuario!, lojaId)) {
    res.status(403).json({ error: "Você não tem acesso a essa loja." });
    return null;
  }
  return lojaId;
}

function percentualValido(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0 && valor <= 80;
}

repricingRouter.get("/lojas", async (req, res) => {
  try {
    const lojas = (await listLojas()).filter((l) => LOJAS_REPRICING.includes(l.id) && temAcessoLoja(req.usuario!, l.id));
    res.json({ lojas: lojas.map((l) => ({ id: l.id, nome: l.nome })) });
  } catch (err) {
    erro(res, err, "Falha ao carregar as lojas do Repricing.");
  }
});

repricingRouter.get("/", async (req, res) => {
  const lojaId = resolverLoja(req, res, req.query.lojaId);
  if (lojaId === null) return;
  try {
    res.json(await obterPainel(lojaId));
  } catch (err) {
    erro(res, err, "Falha ao carregar o Repricing.");
  }
});

repricingRouter.put("/config", async (req, res) => {
  const lojaId = resolverLoja(req, res, req.body?.lojaId);
  if (lojaId === null) return;
  const { margemMinimaPercentual, roboPausado, promocoesAutomaticas } = req.body;
  if (margemMinimaPercentual !== undefined && !percentualValido(margemMinimaPercentual)) {
    res.status(400).json({ error: "Informe a margem mínima entre 0% e 80%." });
    return;
  }
  if (
    (roboPausado !== undefined && typeof roboPausado !== "boolean") ||
    (promocoesAutomaticas !== undefined && typeof promocoesAutomaticas !== "boolean")
  ) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await salvarConfig(lojaId, { margemMinimaPercentual, roboPausado, promocoesAutomaticas });
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao salvar a configuração.");
  }
});

// A rodada completa leva minutos — dispara e responde na hora; a tela
// acompanha pelo campo "sincronizando" do GET.
repricingRouter.post("/sincronizar", (req, res) => {
  const lojaId = resolverLoja(req, res, req.body?.lojaId);
  if (lojaId === null) return;
  void sincronizarLoja(lojaId);
  res.json({ ok: true });
});

repricingRouter.put("/itens/:itemId", async (req, res) => {
  const lojaId = resolverLoja(req, res, req.body?.lojaId);
  if (lojaId === null) return;
  const { margemMinimaPercentual, precoMaximo } = req.body;
  if (margemMinimaPercentual !== undefined && margemMinimaPercentual !== null && !percentualValido(margemMinimaPercentual)) {
    res.status(400).json({ error: "Informe a margem mínima entre 0% e 80%." });
    return;
  }
  if (precoMaximo !== undefined && precoMaximo !== null && !(typeof precoMaximo === "number" && Number.isFinite(precoMaximo) && precoMaximo > 0)) {
    res.status(400).json({ error: "Preço máximo inválido." });
    return;
  }
  try {
    await salvarAjustesItem(lojaId, req.params.itemId, { margemMinimaPercentual, precoMaximo });
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao salvar o ajuste do anúncio.");
  }
});

repricingRouter.post("/itens/:itemId/robo", async (req, res) => {
  const lojaId = resolverLoja(req, res, req.body?.lojaId);
  if (lojaId === null) return;
  const { ligar } = req.body;
  if (typeof ligar !== "boolean") {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await (ligar ? ligarRobo(lojaId, req.params.itemId, req.usuario!.id) : desligarRobo(lojaId, req.params.itemId, req.usuario!.id));
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, ligar ? "Falha ao ligar o robô." : "Falha ao desligar o robô.");
  }
});

repricingRouter.post("/robo-em-massa", async (req, res) => {
  const lojaId = resolverLoja(req, res, req.body?.lojaId);
  if (lojaId === null) return;
  const { itemIds, ligar } = req.body;
  if (
    typeof ligar !== "boolean" ||
    !Array.isArray(itemIds) ||
    itemIds.length === 0 ||
    itemIds.length > MAX_ITENS_EM_MASSA ||
    !itemIds.every((id) => typeof id === "string")
  ) {
    res.status(400).json({ error: `Selecione entre 1 e ${MAX_ITENS_EM_MASSA} anúncios.` });
    return;
  }
  try {
    res.json({ resultados: await alternarRoboEmMassa(lojaId, itemIds, ligar, req.usuario!.id) });
  } catch (err) {
    erro(res, err, "Falha na alteração em massa.");
  }
});

repricingRouter.get("/promocoes", async (req, res) => {
  const lojaId = resolverLoja(req, res, req.query.lojaId);
  if (lojaId === null) return;
  try {
    res.json(await obterPainelPromocoes(lojaId));
  } catch (err) {
    erro(res, err, "Falha ao carregar as promoções.");
  }
});

repricingRouter.post("/promocoes/buscar", async (req, res) => {
  const lojaId = resolverLoja(req, res, req.body?.lojaId);
  if (lojaId === null) return;
  try {
    await buscarPromocoesAgora(lojaId);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao iniciar a busca de promoções.");
  }
});

repricingRouter.post("/promocoes/entrar", async (req, res) => {
  const lojaId = resolverLoja(req, res, req.body?.lojaId);
  if (lojaId === null) return;
  try {
    res.json(await entrarNasPromocoesComMargem(lojaId, MAX_PROMOCOES_POR_CLIQUE));
  } catch (err) {
    erro(res, err, "Falha ao entrar nas promoções.");
  }
});
