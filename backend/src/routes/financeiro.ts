import { Router, Request, Response } from "express";
import { listarVendasFinanceiras, calcularPontoEquilibrio } from "../services/financeiroService";
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

// Resolve o filtro de loja (id específico, "todas" ou "minhas") pro usuário
// logado, igual à rota "/" — devolve null e já responde o erro se a loja
// pedida não é permitida.
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

financeiroRouter.get("/", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  const { dataInicio, dataFim } = extrairDatas(req);
  const forcar = req.query.forcar === "1";

  try {
    const resultado = await listarVendasFinanceiras(
      filtro.lojaId,
      filtro.lojasPermitidas,
      dataInicio,
      dataFim,
      forcar
    );
    res.json(resultado);
  } catch (err) {
    console.error("Erro ao montar feed financeiro:", err);
    res.status(500).json({ error: "Falha ao carregar vendas." });
  }
});

// Ponto de equilíbrio: sempre o mês corrente, não usa dataInicio/dataFim.
// Custo fixo é por loja (editável em /api/lojas/:id/custo-fixo) — aqui só
// soma o das lojas que entram no filtro atual.
financeiroRouter.get("/ponto-equilibrio", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  const forcar = req.query.forcar === "1";

  try {
    const resultado = await calcularPontoEquilibrio(filtro.lojaId, filtro.lojasPermitidas, forcar);
    res.json(resultado);
  } catch (err) {
    console.error("Erro ao calcular ponto de equilíbrio:", err);
    res.status(500).json({ error: "Falha ao calcular ponto de equilíbrio." });
  }
});
