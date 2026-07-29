import { Router } from "express";
import { getDashboardData } from "../services/dashboardService";

export const dashboardRouter = Router();

dashboardRouter.get("/", async (req, res) => {
  const lojaIdParam = req.query.lojaId;
  const lojaId =
    typeof lojaIdParam === "string" && Number.isInteger(Number(lojaIdParam)) ? Number(lojaIdParam) : undefined;
  const usuario = req.usuario!;

  if (lojaId !== undefined && !usuario.admin && !usuario.lojas.includes(lojaId)) {
    res.status(403).json({ error: "Você não tem acesso a essa loja." });
    return;
  }

  try {
    const data = await getDashboardData(lojaId, usuario.admin ? undefined : usuario.lojas);
    res.json(data);
  } catch (err) {
    console.error("Erro ao montar dashboard:", err);
    res.status(500).json({ error: "Falha ao carregar dados do dashboard." });
  }
});
