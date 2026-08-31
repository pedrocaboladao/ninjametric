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
import { financeiroShopeeRouter } from "./routes/financeiroShopee";
import { adsRouter } from "./routes/ads";
import { contasRouter } from "./routes/contas";
import { dreRouter } from "./routes/dre";
import { correcoesRouter } from "./routes/correcoes";
import { fabricacaoRouter } from "./routes/fabricacao";
import { fabricaProdutosRouter } from "./routes/fabricaProdutos";
import { fabricaClientesRouter } from "./routes/fabricaClientes";
import { fabricaPixRouter } from "./routes/fabricaPix";
import { fabricaEntradasRouter } from "./routes/fabricaEntradas";
import { fabricaBlingRouter, fabricaBlingCallbackRouter } from "./routes/fabricaBling";
import { shopeeRouter, shopeeCallbackRouter } from "./routes/shopee";
import { fabricaEmbalagensRouter } from "./routes/fabricaEmbalagens";
import { fabricaEstoqueRouter } from "./routes/fabricaEstoque";
import { fabricaPedidosRouter } from "./routes/fabricaPedidos";
import { fabricaContasRouter } from "./routes/fabricaContas";
import { fabricaBensRouter } from "./routes/fabricaBens";
import { fabricaFornecedoresRouter } from "./routes/fabricaFornecedores";
import { fabricaCreditosRouter } from "./routes/fabricaCreditos";
import { fabricaOrdemRouter } from "./routes/fabricaOrdem";
import { promocoesRouter } from "./routes/promocoes";
import { pesquisaRouter } from "./routes/pesquisa";
import { agentesRouter } from "./routes/agentes";
import { whatsappRouter } from "./routes/whatsapp";
import { marketIntelligenceRouter } from "./routes/marketIntelligence";
import { internalRouter } from "./routes/internal";
import { requireAuth, requirePermissao, requireAdmin } from "./middleware/requireAuth";
import { iniciarPrewarmPromocoes } from "./services/promoPrewarm";
import { iniciarSnapshotAds } from "./services/adsService";
import { iniciarSincronizacaoPromocoes } from "./services/promocoesService";
import { iniciarSincronizacaoVendas } from "./services/fabricaSincAutomaticaService";
import { iniciarVerificacaoAgenteAds } from "./services/agenteAdsService";
import { iniciarGrowthHacker } from "./services/growthHackerService";
import { iniciarSnapshotEstoque } from "./services/estoqueService";
import { iniciarSnapshotVendasNegativas } from "./services/vendasNegativasService";
import { iniciarVerificacaoOportunidades } from "./services/agenteOportunidadesService";
import { iniciarSnapshotCatalogo } from "./services/agenteCatalogoService";
import { iniciarVerificacaoAgenteConversao } from "./services/agenteConversaoService";
import { iniciarVerificacaoPlanoDiario } from "./services/agentePlanoDiarioService";
import { iniciarSnapshotAnunciosNegativos } from "./services/anunciosNegativosService";
import { iniciarSnapshotExperienciaCompra } from "./services/experienciaCompraService";
import { iniciarWhatsApp } from "./services/whatsappService";

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
app.use("/api/financeiro-shopee", requireAuth, requirePermissao("financeiro_shopee"), financeiroShopeeRouter);
app.use("/api/ads", requireAuth, requirePermissao("ads"), adsRouter);
app.use("/api/contas", requireAuth, requirePermissao("contas"), contasRouter);
app.use("/api/dre", requireAuth, requirePermissao("dre"), dreRouter);
app.use("/api/correcoes", requireAuth, requirePermissao("correcoes"), correcoesRouter);
app.use("/api/fabricacao", requireAuth, requirePermissao("fabricacao"), fabricacaoRouter);
app.use("/api/fabrica-produtos", requireAuth, requirePermissao("fabrica_produtos"), fabricaProdutosRouter);
app.use("/api/fabrica-clientes", requireAuth, requirePermissao("fabrica_clientes"), fabricaClientesRouter);
app.use("/api/fabrica-embalagens", requireAuth, requirePermissao("fabrica_embalagens"), fabricaEmbalagensRouter);
app.use("/api/fabrica-estoque", requireAuth, requirePermissao("fabrica_estoque"), fabricaEstoqueRouter);
app.use("/api/fabrica-pedidos", requireAuth, requirePermissao("fabrica_pedidos"), fabricaPedidosRouter);
app.use("/api/fabrica-contas", requireAuth, requirePermissao("fabrica_financeiro"), fabricaContasRouter);
app.use("/api/fabrica-pix", requireAuth, requirePermissao("fabrica_financeiro"), fabricaPixRouter);
app.use("/api/fabrica-entradas", requireAuth, requirePermissao("fabrica_estoque"), fabricaEntradasRouter);
// O callback do Bling chega pelo navegador vindo de fora, sem o cookie da
// sessão — por isso fica antes do requireAuth. O que protege é o state, que
// só existe se alguém autenticado começou a autorização.
app.use("/api/fabrica-bling/callback", fabricaBlingCallbackRouter);
app.use("/api/fabrica-bling", requireAuth, requirePermissao("fabrica_pedidos"), fabricaBlingRouter);
// Mesmo motivo do callback do Bling acima: a Shopee chama essa URL direto,
// sem cookie de sessão, então fica antes do requireAuth.
app.use("/api/shopee/callback", shopeeCallbackRouter);
app.use("/api/shopee", requireAuth, requireAdmin, shopeeRouter);
// mesma permissao do financeiro da fabrica: o cadastro de bens existe pra
// alimentar a depreciacao do DRE, nao e modulo separado
app.use("/api/fabrica-bens", requireAuth, requirePermissao("fabrica_financeiro"), fabricaBensRouter);
app.use(
  "/api/fabrica-fornecedores",
  requireAuth,
  requirePermissao("fabrica_financeiro"),
  fabricaFornecedoresRouter
);
// credito da loja (antecipacao e bonificacao de 3,5%) anda junto com o
// contas a receber, entao usa a mesma permissao dos pedidos
app.use(
  "/api/fabrica-creditos",
  requireAuth,
  requirePermissao("fabrica_pedidos"),
  fabricaCreditosRouter
);
app.use("/api/fabrica-ordem", requireAuth, requirePermissao("fabricacao"), fabricaOrdemRouter);
app.use("/api/promocoes", requireAuth, requirePermissao("promocoes"), promocoesRouter);
app.use("/api/pesquisa", requireAuth, requirePermissao("pesquisa"), pesquisaRouter);
// Admin-only (mesmo padrão de /api/usuarios) — não é módulo comum, não
// aparece como checkbox liberável pra equipe.
app.use("/api/agentes", requireAuth, requireAdmin, agentesRouter);
// Tela de setup do QR do bot de WhatsApp — admin-only, mesmo padrão de /api/agentes.
app.use("/api/whatsapp", requireAuth, requireAdmin, whatsappRouter);
// Proxy pro serviço isolado market-intelligence — admin-only no Fase 1
// (API paga por request, controle de custo fica só com o dono por enquanto).
app.use("/api/market-intelligence", requireAuth, requireAdmin, marketIntelligenceRouter);
// Serviço-a-serviço (market-intelligence -> ml-core) — sem requireAuth de
// propósito, não é chamado pelo navegador, só protegido pela chave interna
// dentro do próprio router. Ver routes/internal.ts.
app.use("/internal", internalRouter);

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
iniciarSincronizacaoVendas();
iniciarVerificacaoAgenteAds();
iniciarGrowthHacker();
iniciarSnapshotEstoque();
iniciarSnapshotVendasNegativas();
iniciarVerificacaoOportunidades();
iniciarSnapshotCatalogo();
iniciarVerificacaoAgenteConversao();
iniciarVerificacaoPlanoDiario();
iniciarSnapshotAnunciosNegativos();
iniciarSnapshotExperienciaCompra();
iniciarWhatsApp();
