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
import { correcoesRouter } from "./routes/correcoes";
import { fabricacaoRouter } from "./routes/fabricacao";
import { promocoesRouter } from "./routes/promocoes";
import { agentesRouter } from "./routes/agentes";
import { requireAuth, requirePermissao, requireAdmin } from "./middleware/requireAuth";
import { iniciarPrewarmPromocoes } from "./services/promoPrewarm";
import { iniciarSnapshotAds } from "./services/adsService";
import { iniciarSincronizacaoPromocoes } from "./services/promocoesService";
import { iniciarVerificacaoAgenteAds } from "./services/agenteAdsService";
import { iniciarGrowthHacker } from "./services/growthHackerService";
import { iniciarSnapshotEstoque } from "./services/estoqueService";
import { iniciarSnapshotVendasNegativas } from "./services/vendasNegativasService";
import { iniciarVerificacaoOportunidades } from "./services/agenteOportunidadesService";
import { iniciarSnapshotCatalogo } from "./services/agenteCatalogoService";
import { iniciarVerificacaoAgenteConversao } from "./services/agenteConversaoService";
import { iniciarVerificacaoPlanoDiario } from "./services/agentePlanoDiarioService";
import { iniciarSnapshotAnunciosNegativos } from "./services/anunciosNegativosService";

const app = express();

app.use(cors({ origin: env.corsOrigins, credentials: true }));
// Limite maior que o padrão (100kb) pra caber foto de produto em base64
// (Agente de Imagens) no corpo da requisição.
app.use(express.json({ limit: "25mb" }));
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
app.use("/api/correcoes", requireAuth, requirePermissao("correcoes"), correcoesRouter);
app.use("/api/fabricacao", requireAuth, requirePermissao("fabricacao"), fabricacaoRouter);
app.use("/api/promocoes", requireAuth, requirePermissao("promocoes"), promocoesRouter);
// Admin-only (mesmo padrão de /api/usuarios) — não é módulo comum, não
// aparece como checkbox liberável pra equipe.
app.use("/api/agentes", requireAuth, requireAdmin, agentesRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const server = app.listen(env.port, () => {
  console.log(`Backend rodando em http://localhost:${env.port}`);
});

// Timeouts padrão do Node (60s-120s dependendo da versão/propriedade) são
// curtos demais pro Growth Hacker (Opus + raciocínio "xhigh" + dados de 16
// lojas), que pode legitimamente levar minutos pra responder — sem isso o
// próprio Node derruba a conexão antes do Nginx (já ajustado pra 300s, ver
// deploy.yml) nem chegar a reclamar.
server.timeout = 360_000;
server.headersTimeout = 360_000;
server.requestTimeout = 360_000;

iniciarPrewarmPromocoes();
iniciarSnapshotAds();
iniciarSincronizacaoPromocoes();
iniciarVerificacaoAgenteAds();
iniciarGrowthHacker();
iniciarSnapshotEstoque();
iniciarSnapshotVendasNegativas();
iniciarVerificacaoOportunidades();
iniciarSnapshotCatalogo();
iniciarVerificacaoAgenteConversao();
iniciarVerificacaoPlanoDiario();
iniciarSnapshotAnunciosNegativos();
