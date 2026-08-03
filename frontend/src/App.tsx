import { useEffect, useState } from "react";
import { Sidebar, type View } from "./components/Sidebar";
import { Dashboard } from "./components/Dashboard";
import { Perguntas } from "./components/Perguntas";
import { ClonarAnuncio } from "./components/ClonarAnuncio";
import { Produtos } from "./components/Produtos";
import { Financeiro } from "./components/Financeiro";
import { Contas } from "./components/Contas";
import { Ads } from "./components/Ads";
import { Tarefas } from "./components/Tarefas";
import { Funcionarios } from "./components/Funcionarios";
import { Usuarios } from "./components/Usuarios";
import { Login } from "./components/Login";
import { usePerguntas } from "./hooks/usePerguntas";
import { checarSessao, logout } from "./api/session";
import { temPermissao } from "./constants/modulos";
import type { Usuario } from "./types/usuarios";
import "./App.css";

function primeiraViewPermitida(usuario: Usuario): View {
  if (temPermissao(usuario, "dashboard")) return "dashboard";
  if (temPermissao(usuario, "perguntas")) return "perguntas";
  if (temPermissao(usuario, "clonar")) return "clonar";
  if (temPermissao(usuario, "produtos")) return "produtos";
  if (temPermissao(usuario, "financeiro")) return "financeiro";
  if (temPermissao(usuario, "contas")) return "contas";
  if (temPermissao(usuario, "ads")) return "ads";
  if (temPermissao(usuario, "tarefas")) return "tarefas";
  if (temPermissao(usuario, "funcionarios")) return "funcionarios";
  if (usuario.admin) return "usuarios";
  return "dashboard";
}

function AppAutenticado({ usuario, onSair }: { usuario: Usuario; onSair: () => void }) {
  const [view, setView] = useState<View>(() => primeiraViewPermitida(usuario));
  const perguntas = usePerguntas(temPermissao(usuario, "perguntas"));

  async function handleSair() {
    await logout();
    onSair();
  }

  const semAcesso = !temPermissao(usuario, view);

  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        onChangeView={setView}
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
        {view === "financeiro" && temPermissao(usuario, "financeiro") && <Financeiro usuario={usuario} />}
        {view === "contas" && temPermissao(usuario, "contas") && <Contas usuario={usuario} />}
        {view === "ads" && temPermissao(usuario, "ads") && <Ads />}
        {view === "tarefas" && temPermissao(usuario, "tarefas") && <Tarefas />}
        {view === "funcionarios" && temPermissao(usuario, "funcionarios") && <Funcionarios />}
        {view === "usuarios" && usuario.admin && <Usuarios />}
      </main>
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

  return <AppAutenticado usuario={usuario} onSair={() => setUsuario(null)} />;
}

export default App;
