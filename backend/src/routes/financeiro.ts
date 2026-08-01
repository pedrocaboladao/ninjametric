import { Router } from "express";
import { listarVendasFinanceiras } from "../services/financeiroService";
import { temAcessoLoja, lojasEfetivas } from "../services/usuariosService";

export const financeiroRouter = Router();

financeiroRouter.get("/", async (req, res) => {
  const lojaIdParam = req.query.lojaId;
  const usuario = req.usuario!;

  if (lojaIdParam === "minhas") {
    try {
      const vendas = await listarVendasFinanceiras(undefined, usuario.lojas);
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
    const vendas = await listarVendasFinanceiras(lojaId, lojasEfetivas(usuario));
    res.json({ vendas });
  } catch (err) {
    console.error("Erro ao montar feed financeiro:", err);
    res.status(500).json({ error: "Falha ao carregar vendas." });
  }
});
