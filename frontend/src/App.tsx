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
import { GeradorEan } from "./components/GeradorEan";
import { Promocoes } from "./components/Promocoes";
import { PesquisaMercado } from "./components/PesquisaMercado";
import { Financeiro } from "./components/Financeiro";
import { Contas } from "./components/Contas";
import { Dre } from "./components/Dre";
import { Ads } from "./components/Ads";
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
  "contas",
  "dre",
  "ads",
  "fabricacao",
  "promocoes",
  "pesquisa",
  "tarefas",
  "funcionarios",
  "usuarios",
  "agentes",
  "market_intelligence",
];

function viewInicial(usuario: Usuario): View {
  const salva = localStorage.getItem(CHAVE_ULTIMA_VIEW) as View | null;
  if (
    salva &&
    VIEWS_VALIDAS.includes(salva) &&
    (salva === "usuarios" || salva === "agentes" || salva === "market_intelligence"
      ? usuario.admin
      : temPermissao(usuario, salva))
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
  if (temPermissao(usuario, "contas")) return "contas";
  if (temPermissao(usuario, "dre")) return "dre";
  if (temPermissao(usuario, "ads")) return "ads";
  if (temPermissao(usuario, "fabricacao")) return "fabricacao";
  if (temPermissao(usuario, "fabrica_produtos")) return "fabrica_produtos";
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

  const semAcesso = !temPermissao(usuario, view);

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
        {view === "contas" && temPermissao(usuario, "contas") && <Contas usuario={usuario} />}
        {view === "dre" && temPermissao(usuario, "dre") && <Dre />}
        {view === "ads" && temPermissao(usuario, "ads") && <Ads />}
        {view === "fabricacao" && temPermissao(usuario, "fabricacao") && <Fabricacao />}
        {view === "fabrica_produtos" && temPermissao(usuario, "fabrica_produtos") && <FabricaProdutos />}
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
