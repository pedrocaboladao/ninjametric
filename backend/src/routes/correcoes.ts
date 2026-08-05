import { Router, Request, Response } from "express";
import { listarSkusSemCusto } from "../services/correcoesService";
import { temAcessoLoja, lojasEfetivas } from "../services/usuariosService";

export const correcoesRouter = Router();

// Mesmo padrão duplicado por arquivo do resto do sistema (ver financeiro.ts,
// ads.ts) — "minhas" usa o array bruto do usuário, "todas"/específica usa
// lojasEfetivas (admin/todasLojas ignora a restrição).
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

correcoesRouter.get("/", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  const forcar = req.query.forcar === "1";

  try {
    const itens = await listarSkusSemCusto(filtro.lojaId, filtro.lojasPermitidas, forcar);
    res.json({ itens });
  } catch (err) {
    console.error("Erro ao listar SKUs sem custo cadastrado:", err);
    res.status(500).json({ error: "Falha ao carregar correções pendentes." });
  }
});
