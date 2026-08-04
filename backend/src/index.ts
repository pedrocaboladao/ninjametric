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
import { empacotadoresRouter } from "./routes/empacotadores";
import { usuariosRouter } from "./routes/usuarios";
import { youtubeRouter } from "./routes/youtube";
import { produtosRouter } from "./routes/produtos";
import { financeiroRouter } from "./routes/financeiro";
import { adsRouter } from "./routes/ads";
import { contasRouter } from "./routes/contas";
import { dreRouter } from "./routes/dre";
import { requireAuth, requirePermissao, requireAdmin } from "./middleware/requireAuth";
import { iniciarPrewarmPromocoes } from "./services/promoPrewarm";
import { iniciarSnapshotAds } from "./services/adsService";

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Callback do Mercado Livre precisa ficar público (o ML chama direto, sem cookie nosso).
app.use("/auth", authRouter);

// Login/logout/checagem de sessão também são públicos.
app.use("/api/session", sessionRouter);

app.use("/api/dashboard", requireAuth, requirePermissao("dashboard"), dashboardRouter);
app.use("/api/perguntas", requireAuth, requirePermissao("perguntas"), perguntasRouter);
app.use("/api/clonar-anuncio", requireAuth, requirePermissao("clonar"), clonarAnuncioRouter);
app.use("/api/lojas", requireAuth, lojasRouter);
app.use("/api/tarefas", requireAuth, requirePermissao("tarefas"), tarefasRouter);
app.use("/api/empacotadores", requireAuth, requirePermissao("funcionarios"), empacotadoresRouter);
app.use("/api/usuarios", requireAuth, requireAdmin, usuariosRouter);
app.use("/api/youtube", requireAuth, youtubeRouter);
app.use("/api/produtos", requireAuth, requirePermissao("produtos"), produtosRouter);
app.use("/api/financeiro", requireAuth, requirePermissao("financeiro"), financeiroRouter);
app.use("/api/ads", requireAuth, requirePermissao("ads"), adsRouter);
app.use("/api/contas", requireAuth, requirePermissao("contas"), contasRouter);
app.use("/api/dre", requireAuth, requirePermissao("dre"), dreRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(env.port, () => {
  console.log(`Backend rodando em http://localhost:${env.port}`);
});

iniciarPrewarmPromocoes();
iniciarSnapshotAds();
