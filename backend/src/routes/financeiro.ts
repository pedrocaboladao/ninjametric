import { Router, Request, Response } from "express";
import { listarVendasFinanceiras, atualizarCustoFixoMensal, calcularPontoEquilibrio } from "../services/financeiroService";
import { temAcessoLoja, lojasEfetivas } from "../services/usuariosService";
import { requireAdmin } from "../middleware/requireAuth";

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

// Custo fixo mensal (aluguel, salários etc.) — da empresa toda, usado no
// ponto de equilíbrio (devolvido junto de /ponto-equilibrio). Só admin edita.
financeiroRouter.put("/custo-fixo", requireAdmin, async (req, res) => {
  const { custoFixoMensal } = req.body;
  if (typeof custoFixoMensal !== "number" || custoFixoMensal < 0) {
    res.status(400).json({ error: "Informe um valor de custo fixo válido." });
    return;
  }
  try {
    await atualizarCustoFixoMensal(custoFixoMensal);
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao atualizar custo fixo:", err);
    res.status(500).json({ error: "Falha ao atualizar custo fixo." });
  }
});

// Ponto de equilíbrio: sempre o mês corrente, não usa dataInicio/dataFim.
financeiroRouter.get("/ponto-equilibrio", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;

  try {
    const resultado = await calcularPontoEquilibrio(filtro.lojaId, filtro.lojasPermitidas);
    res.json(resultado);
  } catch (err) {
    console.error("Erro ao calcular ponto de equilíbrio:", err);
    res.status(500).json({ error: "Falha ao calcular ponto de equilíbrio." });
  }
});
