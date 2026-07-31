import { Router } from "express";
import { getDashboardData, getTopVendidosPromocoes } from "../services/dashboardService";
import { temAcessoLoja, lojasEfetivas } from "../services/usuariosService";

export const dashboardRouter = Router();

dashboardRouter.get("/", async (req, res) => {
  const lojaIdParam = req.query.lojaId;
  const usuario = req.usuario!;

  if (lojaIdParam === "minhas") {
    try {
      const data = await getDashboardData(undefined, usuario.lojas);
      res.json(data);
    } catch (err) {
      console.error("Erro ao montar dashboard:", err);
      res.status(500).json({ error: "Falha ao carregar dados do dashboard." });
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
    const data = await getDashboardData(lojaId, lojasEfetivas(usuario));
    res.json(data);
  } catch (err) {
    console.error("Erro ao montar dashboard:", err);
    res.status(500).json({ error: "Falha ao carregar dados do dashboard." });
  }
});

dashboardRouter.get("/top-vendidos", async (req, res) => {
  const lojaIdParam = req.query.lojaId;
  const usuario = req.usuario!;

  if (lojaIdParam === "minhas") {
    try {
      const produtos = await getTopVendidosPromocoes(undefined, usuario.lojas);
      res.json({ produtos });
    } catch (err) {
      console.error("Erro ao montar top vendidos:", err);
      res.status(500).json({ error: "Falha ao carregar top vendidos." });
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
    const produtos = await getTopVendidosPromocoes(lojaId, lojasEfetivas(usuario));
    res.json({ produtos });
  } catch (err) {
    console.error("Erro ao montar top vendidos:", err);
    res.status(500).json({ error: "Falha ao carregar top vendidos." });
  }
});
