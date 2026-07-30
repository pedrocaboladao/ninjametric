import { Router } from "express";
import axios from "axios";
import { getDashboardData } from "../services/dashboardService";
import { temAcessoLoja, lojasEfetivas } from "../services/usuariosService";
import { getValidAccessToken } from "../services/tokenStore";

export const dashboardRouter = Router();

// TEMP: rota de depuração para inspecionar o formato real da API de promoções do ML.
dashboardRouter.get("/debug-promo", async (req, res) => {
  try {
    const lojaId = Number(req.query.lojaId);
    const itemId = String(req.query.itemId);
    const token = await getValidAccessToken(lojaId);
    const { data } = await axios.get(`https://api.mercadolibre.com/seller-promotions/items/${itemId}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { app_version: "v2" },
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message, resposta: err.response?.data });
  }
});

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
