import { Router, Request, Response } from "express";
import { listarVendasFinanceirasShopee, diagnosticarAfiliadoShopee } from "../services/financeiroShopeeService";
import { temAcessoLoja, lojasEfetivas } from "../services/usuariosService";
import { listLojas } from "../services/tokenStore";

export const financeiroShopeeRouter = Router();

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function extrairDatas(req: Request): { dataInicio?: string; dataFim?: string } {
  const { dataInicio, dataFim } = req.query;
  if (typeof dataInicio === "string" && typeof dataFim === "string" && DATA_REGEX.test(dataInicio) && DATA_REGEX.test(dataFim)) {
    return { dataInicio, dataFim };
  }
  return {};
}

// Resolve o filtro de loja (id específico, "todas" ou "minhas") pro usuário
// logado — mesmo padrão de routes/financeiro.ts.
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

financeiroShopeeRouter.get("/", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  const { dataInicio, dataFim } = extrairDatas(req);
  const forcar = req.query.forcar === "1";

  try {
    const resultado = await listarVendasFinanceirasShopee(
      filtro.lojaId,
      filtro.lojasPermitidas,
      dataInicio,
      dataFim,
      forcar
    );
    res.json(resultado);
  } catch (err) {
    console.error("Erro ao montar feed financeiro Shopee:", err);
    res.status(500).json({ error: "Falha ao carregar vendas da Shopee." });
  }
});

// Diagnóstico da comissão de afiliado (AMS) — só admin. Abra no navegador
// logado: /api/financeiro-shopee/diagnostico-afiliado?loja=pinta&termo=pedra
// (dias e limite opcionais; padrão 7 dias, 12 pedidos).
financeiroShopeeRouter.get("/diagnostico-afiliado", async (req, res) => {
  if (!req.usuario?.admin) {
    res.status(403).json({ error: "Só admin." });
    return;
  }
  // lojaId numérico, ou "loja=pinta" (pedaço do nome) pra não precisar saber o id.
  let lojaId = Number(req.query.lojaId);
  if (!Number.isInteger(lojaId) && typeof req.query.loja === "string") {
    const nome = req.query.loja.toLowerCase();
    const achada = (await listLojas()).find((l) => l.nome.toLowerCase().includes(nome));
    if (achada) lojaId = achada.id;
  }
  if (!Number.isInteger(lojaId)) {
    res.status(400).json({ error: "Informe lojaId ou loja (parte do nome)." });
    return;
  }
  const dias = Math.min(Math.max(Number(req.query.dias) || 7, 1), 30);
  const limite = Math.min(Math.max(Number(req.query.limite) || 12, 1), 30);
  const termo = typeof req.query.termo === "string" && req.query.termo.trim() ? req.query.termo.trim() : null;
  try {
    res.json(await diagnosticarAfiliadoShopee(lojaId, dias, termo, limite));
  } catch (err) {
    console.error("Erro no diagnóstico de afiliado Shopee:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Falha no diagnóstico." });
  }
});
