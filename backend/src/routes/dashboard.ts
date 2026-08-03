import { Router, Request, Response } from "express";
import { getDashboardData, getTopVendidosPromocoes } from "../services/dashboardService";
import { calcularRankingPrecificacao, buscarComparacaoPorSku } from "../services/precificacaoService";
import { temAcessoLoja, lojasEfetivas } from "../services/usuariosService";

export const dashboardRouter = Router();

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function extrairDatas(req: Request): { dataInicio?: string; dataFim?: string } {
  const { dataInicio, dataFim } = req.query;
  if (typeof dataInicio === "string" && typeof dataFim === "string" && DATA_REGEX.test(dataInicio) && DATA_REGEX.test(dataFim)) {
    return { dataInicio, dataFim };
  }
  return {};
}

// Resolve o filtro de loja (id específico, "todas" ou "minhas") pro usuário
// logado — devolve null e já responde o erro se a loja pedida não é
// permitida.
function resolverLojaFiltro(req: Request, res: Response): { lojaId?: number; lojasPermitidas?: number[] } | null {
  const lojaIdParam = req.query.lojaId;
  const usuario = req.usuario!;

  if (lojaIdParam === "minhas") {
    return { lojaId: undefined, lojasPermitidas: usuario.lojas };
  }

  const lojaId =
    typeof lojaIdParam === "string" && Number.isInteger(Number(lojaIdParam)) ? Number(lojaIdParam) : undefined;

  if (lojaId !== undefined && !temAcessoLoja(usuario, lojaId)) {
    res.status(403).json({ error: "Você não tem acesso a essa loja." });
    return null;
  }

  return { lojaId, lojasPermitidas: lojasEfetivas(usuario) };
}

dashboardRouter.get("/", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;

  try {
    const data = await getDashboardData(filtro.lojaId, filtro.lojasPermitidas);
    res.json(data);
  } catch (err) {
    console.error("Erro ao montar dashboard:", err);
    res.status(500).json({ error: "Falha ao carregar dados do dashboard." });
  }
});

dashboardRouter.get("/top-vendidos", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;

  try {
    const produtos = await getTopVendidosPromocoes(filtro.lojaId, filtro.lojasPermitidas);
    res.json({ produtos });
  } catch (err) {
    console.error("Erro ao montar top vendidos:", err);
    res.status(500).json({ error: "Falha ao carregar top vendidos." });
  }
});

dashboardRouter.get("/precificacao", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  const { dataInicio, dataFim } = extrairDatas(req);

  try {
    const ranking = await calcularRankingPrecificacao(filtro.lojaId, filtro.lojasPermitidas, dataInicio, dataFim);
    res.json(ranking);
  } catch (err) {
    console.error("Erro ao montar ranking de precificação:", err);
    res.status(500).json({ error: "Falha ao carregar ranking de precificação." });
  }
});

dashboardRouter.get("/precificacao/sku", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  const { dataInicio, dataFim } = extrairDatas(req);

  const sku = String(req.query.sku ?? "").trim();
  if (!sku) {
    res.status(400).json({ error: "Informe um SKU pra buscar." });
    return;
  }

  try {
    const comparacao = await buscarComparacaoPorSku(sku, filtro.lojaId, filtro.lojasPermitidas, dataInicio, dataFim);
    res.json({ comparacao });
  } catch (err) {
    console.error("Erro ao buscar comparação por SKU:", err);
    res.status(500).json({ error: "Falha ao buscar comparação por SKU." });
  }
});
