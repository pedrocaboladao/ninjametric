import { Router } from "express";
import { getDashboardData } from "../services/dashboardService";

export const dashboardRouter = Router();

dashboardRouter.get("/", async (req, res) => {
  const lojaIdParam = req.query.lojaId;
  const lojaId =
    typeof lojaIdParam === "string" && Number.isInteger(Number(lojaIdParam)) ? Number(lojaIdParam) : undefined;

  try {
    const data = await getDashboardData(lojaId);
    res.json(data);
  } catch (err) {
    console.error("Erro ao montar dashboard:", err);
    res.status(500).json({ error: "Falha ao carregar dados do dashboard." });
  }
});
