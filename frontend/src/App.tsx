import { useCallback, useEffect, useState } from "react";
import { Routes, Route, Navigate, useParams, useNavigate } from "react-router-dom";
import { Sidebar, type View } from "./components/Sidebar";
import { Dashboard } from "./components/Dashboard";
import { Perguntas } from "./components/Perguntas";
import { ClonarAnuncio } from "./components/ClonarAnuncio";
import { Produtos } from "./components/Produtos";
import { Correcoes } from "./components/Correcoes";
import { Fabricacao } from "./components/Fabricacao";
import { FabricaProdutos } from "./components/FabricaProdutos";
import { FabricaClientes } from "./components/FabricaClientes";
import { FabricaEmbalagens } from "./components/FabricaEmbalagens";
import { FabricaEstoque } from "./components/FabricaEstoque";
import { FabricaPedidos } from "./components/FabricaPedidos";
import { FabricaContas } from "./components/FabricaContas";
import { FabricaOrdem } from "./components/FabricaOrdem";
import { GeradorEan } from "./components/GeradorEan";
import { Promocoes } from "./components/Promocoes";
import { PesquisaMercado } from "./components/PesquisaMercado";
import { Financeiro } from "./components/Financeiro";
import { FinanceiroShopee } from "./components/FinanceiroShopee";
import { Contas } from "./components/Contas";
import { Dre } from "./components/Dre";
import { Ads } from "./components/Ads";
import { AdsShopee } from "./components/AdsShopee";
import { Tarefas } from "./components/Tarefas";
import { Funcionarios } from "./components/Funcionarios";
import { Usuarios } from "./components/Usuarios";
import { AgenciaAgentesIA, ModoTVEscritorio } from "./components/AgenciaAgentesIA";
import { IconExpand } from "./components/icons";
import { MarketIntelligence } from "./components/MarketIntelligence";
import { Login } from "./components/Login";
import { usePerguntas } from "./hooks/usePerguntas";
import { checarSessao, logout } from "./api/session";
import { temPermissao } from "./constants/modulos";
import type { Usuario } from "./types/usuarios";
import "./App.css";

const CHAVE_ULTIMA_VIEW = "painel_ultima_view";
const VIEWS_VALIDAS: View[] = [
  "dashboard",
  "perguntas",
  "clonar",
  "produtos",
  "correcoes",
  "ean",
  "financeiro",
  "financeiro_shopee",
  "contas",
  "dre",
  "ads",
  "ads_shopee",
  "fabricacao",
  "fabrica_produtos",
  "fabrica_clientes",
  "fabrica_embalagens",
  "fabrica_estoque",
  "fabrica_pedidos",
  "fabrica_financeiro",
  "fabrica_ordem",
  "promocoes",
  "pesquisa",
  "tarefas",
  "funcionarios",
  "usuarios",
  "agentes",
  "market_intelligence",
];

// Quase toda view tem o mesmo nome da permissao que a protege, e o resto do
// arquivo conta com isso. A excecao e a view que reaproveita permissao de
// outra: "Ordem de fabricacao" e protegida por `fabricacao`, a mesma de quem
// monta a formula — quem monta a receita e quem imprime a ordem, e um modulo
// separado so pra isso obrigaria mais uma liberacao de admin.
//
// Sem este mapa, temPermissao(usuario, "fabrica_ordem") procura uma permissao
// com esse nome, nao acha, e a tela abre com "Nenhum acesso liberado" por cima
// do conteudo — que carregou normalmente, porque a API usa a chave certa.
const PERMISSAO_DA_VIEW: Partial<Record<View, string>> = {
  fabrica_ordem: "fabricacao",
};

function permissaoDaView(view: View): string {
  return PERMISSAO_DA_VIEW[view] ?? view;
}

function viewInicial(usuario: Usuario): View {
  const salva = localStorage.getItem(CHAVE_ULTIMA_VIEW) as View | null;
  if (
    salva &&
    VIEWS_VALIDAS.includes(salva) &&
    (salva === "usuarios" || salva === "agentes" || salva === "market_intelligence"
      ? usuario.admin
      : temPermissao(usuario, permissaoDaView(salva)))
  ) {
    return salva;
  }
  return primeiraViewPermitida(usuario);
}

function primeiraViewPermitida(usuario: Usuario): View {
  if (temPermissao(usuario, "dashboard")) return "dashboard";
  if (temPermissao(usuario, "perguntas")) return "perguntas";
  if (temPermissao(usuario, "clonar")) return "clonar";
  if (temPermissao(usuario, "produtos")) return "produtos";
  if (temPermissao(usuario, "correcoes")) return "correcoes";
  if (temPermissao(usuario, "ean")) return "ean";
  if (temPermissao(usuario, "financeiro")) return "financeiro";
  if (temPermissao(usuario, "financeiro_shopee")) return "financeiro_shopee";
  if (temPermissao(usuario, "contas")) return "contas";
  if (temPermissao(usuario, "dre")) return "dre";
  if (temPermissao(usuario, "ads")) return "ads";
  if (temPermissao(usuario, "ads_shopee")) return "ads_shopee";
  if (temPermissao(usuario, "fabricacao")) return "fabricacao";
  if (temPermissao(usuario, "fabrica_produtos")) return "fabrica_produtos";
  if (temPermissao(usuario, "fabrica_clientes")) return "fabrica_clientes";
  if (temPermissao(usuario, "fabrica_embalagens")) return "fabrica_embalagens";
  if (temPermissao(usuario, "fabrica_estoque")) return "fabrica_estoque";
  if (temPermissao(usuario, "fabrica_pedidos")) return "fabrica_pedidos";
  if (temPermissao(usuario, "fabrica_financeiro")) return "fabrica_financeiro";
  if (temPermissao(usuario, "fabricacao")) return "fabrica_ordem";
  if (temPermissao(usuario, "promocoes")) return "promocoes";
  if (temPermissao(usuario, "pesquisa")) return "pesquisa";
  if (temPermissao(usuario, "tarefas")) return "tarefas";
  if (temPermissao(usuario, "funcionarios")) return "funcionarios";
  if (usuario.admin) return "usuarios";
  return "dashboard";
}

// Cada view agora tem sua própria URL ("/financeiro", "/agentes", etc.) —
// o mecanismo de clicar no menu continua idêntico (troca instantânea, sem
// recarregar a página), só que agora o link muda junto, dá pra favoritar
// uma página específica e o F5 mantém onde você estava. "/" e qualquer
// caminho inválido caem em RotaInicial, que resolve pra última view salva
// (ou a primeira permitida) e redireciona.
function RotaInicial({ usuario }: { usuario: Usuario }) {
  return <Navigate to={`/${viewInicial(usuario)}`} replace />;
}

function AppAutenticado({ usuario, onSair }: { usuario: Usuario; onSair: () => void }) {
  const { view: viewNaUrl } = useParams<{ view: string }>();
  const navigate = useNavigate();
  const perguntas = usePerguntas(temPermissao(usuario, "perguntas"));

  // Se o link não é uma view conhecida (digitada errada, ou salva de uma
  // versão antiga do sistema), cai na view inicial em vez de tela em branco.
  const viewValidaNaUrl = VIEWS_VALIDAS.includes(viewNaUrl as View);
  const view: View = viewValidaNaUrl ? (viewNaUrl as View) : viewInicial(usuario);

  useEffect(() => {
    if (!viewValidaNaUrl) {
      navigate(`/${view}`, { replace: true });
      return;
    }
    localStorage.setItem(CHAVE_ULTIMA_VIEW, view);
  }, [viewValidaNaUrl, view, navigate]);

  async function handleSair() {
    await logout();
    onSair();
  }

  const semAcesso = !temPermissao(usuario, permissaoDaView(view));

  // Botão flutuante do Modo TV só no celular (ver .modo-tv-fab em App.css)
  // e só pra conta do dono — não é um recurso pra equipe em geral, é um
  // atalho pessoal pra abrir o painel do escritório sem precisar navegar
  // até Agentes IA. Estável de propósito, mesmo motivo do sairDoModoTV em
  // AgenciaAgentesIA.tsx: identidade nova a cada render reiniciaria o
  // polling do feed.
  const [modoTV, setModoTV] = useState(false);
  const sairDoModoTV = useCallback(() => setModoTV(false), []);
  const podeModoTVMobile = usuario.username === "pedroca";

  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        onChangeView={(v) => navigate(`/${v}`)}
        perguntasPendentes={perguntas.perguntas?.length ?? 0}
        usuario={usuario}
        onSair={handleSair}
      />
      <main className="app-main">
        {semAcesso && (
          <div className="state-message">Nenhum acesso liberado. Fale com o administrador da conta.</div>
        )}
        {view === "dashboard" && temPermissao(usuario, "dashboard") && <Dashboard usuario={usuario} />}
        {view === "perguntas" && temPermissao(usuario, "perguntas") && (
          <Perguntas
            perguntas={perguntas.perguntas}
            error={perguntas.error}
            loading={perguntas.loading}
            responder={perguntas.responder}
            excluir={perguntas.excluir}
          />
        )}
        {view === "clonar" && temPermissao(usuario, "clonar") && <ClonarAnuncio />}
        {view === "produtos" && temPermissao(usuario, "produtos") && <Produtos />}
        {view === "correcoes" && temPermissao(usuario, "correcoes") && <Correcoes />}
        {view === "ean" && temPermissao(usuario, "ean") && <GeradorEan />}
        {view === "financeiro" && temPermissao(usuario, "financeiro") && <Financeiro usuario={usuario} />}
        {view === "financeiro_shopee" && temPermissao(usuario, "financeiro_shopee") && <FinanceiroShopee />}
        {view === "contas" && temPermissao(usuario, "contas") && <Contas usuario={usuario} />}
        {view === "dre" && temPermissao(usuario, "dre") && <Dre />}
        {view === "ads" && temPermissao(usuario, "ads") && <Ads />}
        {view === "ads_shopee" && temPermissao(usuario, "ads_shopee") && <AdsShopee />}
        {view === "fabricacao" && temPermissao(usuario, "fabricacao") && <Fabricacao />}
        {view === "fabrica_produtos" && temPermissao(usuario, "fabrica_produtos") && <FabricaProdutos />}
        {view === "fabrica_clientes" && temPermissao(usuario, "fabrica_clientes") && <FabricaClientes />}
        {view === "fabrica_embalagens" && temPermissao(usuario, "fabrica_embalagens") && <FabricaEmbalagens />}
        {view === "fabrica_estoque" && temPermissao(usuario, "fabrica_estoque") && <FabricaEstoque />}
        {view === "fabrica_pedidos" && temPermissao(usuario, "fabrica_pedidos") && <FabricaPedidos />}
        {view === "fabrica_financeiro" && temPermissao(usuario, "fabrica_financeiro") && <FabricaContas />}
        {view === "fabrica_ordem" && temPermissao(usuario, "fabricacao") && <FabricaOrdem />}
        {view === "promocoes" && temPermissao(usuario, "promocoes") && <Promocoes />}
        {view === "pesquisa" && temPermissao(usuario, "pesquisa") && <PesquisaMercado />}
        {view === "tarefas" && temPermissao(usuario, "tarefas") && <Tarefas />}
        {view === "funcionarios" && temPermissao(usuario, "funcionarios") && <Funcionarios />}
        {view === "usuarios" && usuario.admin && <Usuarios />}
        {view === "agentes" && usuario.admin && <AgenciaAgentesIA />}
        {view === "market_intelligence" && usuario.admin && <MarketIntelligence />}
      </main>

      {podeModoTVMobile && (
        <button
          type="button"
          className="modo-tv-fab"
          onClick={() => setModoTV(true)}
          aria-label="Abrir Modo TV"
        >
          <IconExpand size={22} />
        </button>
      )}
      {modoTV && <ModoTVEscritorio onSair={sairDoModoTV} />}
    </div>
  );
}

function App() {
  const [usuario, setUsuario] = useState<Usuario | null | undefined>(undefined);

  async function atualizarSessao() {
    setUsuario(await checarSessao());
  }

  useEffect(() => {
    atualizarSessao();
  }, []);

  if (usuario === undefined) {
    return <div className="state-message">Carregando...</div>;
  }

  if (!usuario) {
    return <Login onEntrar={atualizarSessao} />;
  }

  return (
    <Routes>
      <Route path="/:view" element={<AppAutenticado usuario={usuario} onSair={() => setUsuario(null)} />} />
      <Route path="*" element={<RotaInicial usuario={usuario} />} />
    </Routes>
  );
}

export default App;
