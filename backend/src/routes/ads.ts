import { Router, Request, Response } from "express";
import { listarCampanhasAds } from "../services/adsService";
import { listarReceitaRealPorCampanha } from "../services/tacosService";
import { temAcessoLoja, lojasEfetivas } from "../services/usuariosService";

export const adsRouter = Router();

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

adsRouter.get("/", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  const { dataInicio, dataFim } = extrairDatas(req);
  const forcar = req.query.forcar === "1";

  try {
    const campanhas = await listarCampanhasAds(filtro.lojaId, filtro.lojasPermitidas, dataInicio, dataFim, forcar);
    res.json({ campanhas });
  } catch (err) {
    console.error("Erro ao listar campanhas de Ads:", err);
    res.status(500).json({ error: "Falha ao carregar campanhas de Ads." });
  }
});

adsRouter.get("/tacos", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  const { dataInicio, dataFim } = extrairDatas(req);

  try {
    const receitas = await listarReceitaRealPorCampanha(filtro.lojaId, filtro.lojasPermitidas, dataInicio, dataFim);
    res.json({ receitas });
  } catch (err) {
    console.error("Erro ao calcular receita real por campanha:", err);
    res.status(500).json({ error: "Falha ao calcular receita real por campanha." });
  }
});
