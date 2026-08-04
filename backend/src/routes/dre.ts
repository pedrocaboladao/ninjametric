import { Router, Request, Response } from "express";
import { calcularDre } from "../services/dreService";
import { temAcessoLoja, lojasEfetivas } from "../services/usuariosService";

export const dreRouter = Router();

// Mesmo padrão de dashboard.ts/financeiro.ts/ads.ts.
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

dreRouter.get("/", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;

  const anoParam = Number(req.query.ano);
  const ano = Number.isInteger(anoParam) && anoParam >= 2020 && anoParam <= 2035 ? anoParam : new Date().getFullYear();

  try {
    const dre = await calcularDre(ano, filtro.lojaId, filtro.lojasPermitidas);
    res.json(dre);
  } catch (err) {
    console.error("Erro ao calcular DRE:", err);
    res.status(500).json({ error: "Falha ao calcular DRE." });
  }
});
