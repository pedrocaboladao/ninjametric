import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { authRouter } from "./routes/auth";
import { dashboardRouter } from "./routes/dashboard";
import { perguntasRouter } from "./routes/perguntas";
import { clonarAnuncioRouter } from "./routes/clonarAnuncio";
import { lojasRouter } from "./routes/lojas";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/auth", authRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/perguntas", perguntasRouter);
app.use("/api/clonar-anuncio", clonarAnuncioRouter);
app.use("/api/lojas", lojasRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(env.port, () => {
  console.log(`Backend rodando em http://localhost:${env.port}`);
});
