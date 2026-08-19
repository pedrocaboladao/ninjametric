import { Router } from "express";
import { env } from "../config/env";

// Proxy fino pro serviço market-intelligence (sem porta exposta ao host, só
// alcançável dentro da rede interna do docker compose). Quem decide se o
// usuário pode chegar até aqui é o requireAuth+requirePermissao já aplicado
// no mount desta rota em index.ts — o serviço de destino não entende cookie
// nem sessão, só a chave de serviço interna injetada abaixo.
export const marketIntelligenceRouter = Router();

marketIntelligenceRouter.use(async (req, res) => {
  if (!env.marketIntelligenceUrl || !env.internalServiceKey) {
    res.status(503).json({ error: "Inteligência de Mercado não configurada neste ambiente." });
    return;
  }

  const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const destino = `${env.marketIntelligenceUrl}${req.path}${query}`;

  try {
    const resposta = await fetch(destino, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": env.internalServiceKey,
      },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
    });

    const texto = await resposta.text();
    res.status(resposta.status);
    res.setHeader("Content-Type", resposta.headers.get("content-type") ?? "application/json");
    res.send(texto);
  } catch (err) {
    console.error("Falha no proxy pra market-intelligence:", err);
    res.status(502).json({ error: "Inteligência de Mercado indisponível no momento." });
  }
});
