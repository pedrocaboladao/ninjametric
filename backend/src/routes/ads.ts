import { Router, Request } from "express";
import { listarCampanhasAds } from "../services/adsService";
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

adsRouter.get("/", async (req, res) => {
  const lojaIdParam = req.query.lojaId;
  const usuario = req.usuario!;
  const { dataInicio, dataFim } = extrairDatas(req);
  const forcar = req.query.forcar === "1";

  if (lojaIdParam === "minhas") {
    try {
      const campanhas = await listarCampanhasAds(undefined, usuario.lojas, dataInicio, dataFim, forcar);
      res.json({ campanhas });
    } catch (err) {
      console.error("Erro ao listar campanhas de Ads:", err);
      res.status(500).json({ error: "Falha ao carregar campanhas de Ads." });
    }
    return;
  }

  const lojaId =
    typeof lojaIdParam === "string" && Number.isInteger(Number(lojaIdParam)) ? Number(lojaIdParam) : undefined;

  if (lojaId !== undefined && !temAcessoLoja(usuario, lojaId)) {
    res.status(403).json({ error: "Você não tem acesso a essa loja." });
    return;
  }

  try {
    const campanhas = await listarCampanhasAds(lojaId, lojasEfetivas(usuario), dataInicio, dataFim, forcar);
    res.json({ campanhas });
  } catch (err) {
    console.error("Erro ao listar campanhas de Ads:", err);
    res.status(500).json({ error: "Falha ao carregar campanhas de Ads." });
  }
});
