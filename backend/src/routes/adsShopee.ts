import { Router, Request, Response } from "express";
import { listarCampanhasAdsShopee } from "../services/adsShopeeService";
import { temAcessoLoja, lojasEfetivas } from "../services/usuariosService";

export const adsShopeeRouter = Router();

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function extrairDatas(req: Request): { dataInicio: string; dataFim: string } {
  const { dataInicio, dataFim } = req.query;
  if (typeof dataInicio === "string" && typeof dataFim === "string" && DATA_REGEX.test(dataInicio) && DATA_REGEX.test(dataFim)) {
    return { dataInicio, dataFim };
  }
  const hoje = new Date().toISOString().slice(0, 10);
  return { dataInicio: hoje, dataFim: hoje };
}

// Mesmo padrão de routes/financeiroShopee.ts.
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

adsShopeeRouter.get("/", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  const { dataInicio, dataFim } = extrairDatas(req);
  const forcar = req.query.forcar === "1";

  try {
    const campanhas = await listarCampanhasAdsShopee(filtro.lojaId, filtro.lojasPermitidas, dataInicio, dataFim, forcar);
    res.json({ campanhas });
  } catch (err) {
    console.error("Erro ao listar campanhas de Ads da Shopee:", err);
    res.status(500).json({ error: "Falha ao carregar campanhas de Ads da Shopee." });
  }
});
