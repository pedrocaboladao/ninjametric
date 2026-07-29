import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import { authRouter } from "./routes/auth";
import { sessionRouter } from "./routes/session";
import { dashboardRouter } from "./routes/dashboard";
import { perguntasRouter } from "./routes/perguntas";
import { clonarAnuncioRouter } from "./routes/clonarAnuncio";
import { lojasRouter } from "./routes/lojas";
import { tarefasRouter } from "./routes/tarefas";
import { requireAuth } from "./middleware/requireAuth";

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Callback do Mercado Livre precisa ficar público (o ML chama direto, sem cookie nosso).
app.use("/auth", authRouter);

// Login/logout/checagem de sessão também são públicos.
app.use("/api/session", sessionRouter);

app.use("/api/dashboard", requireAuth, dashboardRouter);
app.use("/api/perguntas", requireAuth, perguntasRouter);
app.use("/api/clonar-anuncio", requireAuth, clonarAnuncioRouter);
app.use("/api/lojas", requireAuth, lojasRouter);
app.use("/api/tarefas", requireAuth, tarefasRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(env.port, () => {
  console.log(`Backend rodando em http://localhost:${env.port}`);
});
