import { Router, Request } from "express";
import { listarVendasFinanceiras } from "../services/financeiroService";
import { temAcessoLoja, lojasEfetivas } from "../services/usuariosService";

export const financeiroRouter = Router();

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function extrairDatas(req: Request): { dataInicio?: string; dataFim?: string } {
  const { dataInicio, dataFim } = req.query;
  if (typeof dataInicio === "string" && typeof dataFim === "string" && DATA_REGEX.test(dataInicio) && DATA_REGEX.test(dataFim)) {
    return { dataInicio, dataFim };
  }
  return {};
}

financeiroRouter.get("/", async (req, res) => {
  const lojaIdParam = req.query.lojaId;
  const usuario = req.usuario!;
  const { dataInicio, dataFim } = extrairDatas(req);

  if (lojaIdParam === "minhas") {
    try {
      const vendas = await listarVendasFinanceiras(undefined, usuario.lojas, dataInicio, dataFim);
      res.json({ vendas });
    } catch (err) {
      console.error("Erro ao montar feed financeiro:", err);
      res.status(500).json({ error: "Falha ao carregar vendas." });
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
    const vendas = await listarVendasFinanceiras(lojaId, lojasEfetivas(usuario), dataInicio, dataFim);
    res.json({ vendas });
  } catch (err) {
    console.error("Erro ao montar feed financeiro:", err);
    res.status(500).json({ error: "Falha ao carregar vendas." });
  }
});
