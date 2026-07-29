import { useEffect, useState } from "react";
import { Sidebar, type View } from "./components/Sidebar";
import { Dashboard } from "./components/Dashboard";
import { Perguntas } from "./components/Perguntas";
import { ClonarAnuncio } from "./components/ClonarAnuncio";
import { Tarefas } from "./components/Tarefas";
import { Funcionarios } from "./components/Funcionarios";
import { Login } from "./components/Login";
import { usePerguntas } from "./hooks/usePerguntas";
import { checarSessao, logout } from "./api/session";
import "./App.css";

function AppAutenticado({ onSair }: { onSair: () => void }) {
  const [view, setView] = useState<View>("dashboard");
  const perguntas = usePerguntas();

  async function handleSair() {
    await logout();
    onSair();
  }

  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        onChangeView={setView}
        perguntasPendentes={perguntas.perguntas?.length ?? 0}
        onSair={handleSair}
      />
      <main className="app-main">
        {view === "dashboard" && <Dashboard />}
        {view === "perguntas" && (
          <Perguntas
            perguntas={perguntas.perguntas}
            error={perguntas.error}
            loading={perguntas.loading}
            responder={perguntas.responder}
            excluir={perguntas.excluir}
          />
        )}
        {view === "clonar" && <ClonarAnuncio />}
        {view === "tarefas" && <Tarefas />}
        {view === "funcionarios" && <Funcionarios />}
      </main>
    </div>
  );
}

function App() {
  const [autenticado, setAutenticado] = useState<boolean | null>(null);

  useEffect(() => {
    checarSessao().then(setAutenticado);
  }, []);

  if (autenticado === null) {
    return <div className="state-message">Carregando...</div>;
  }

  if (!autenticado) {
    return <Login onEntrar={() => setAutenticado(true)} />;
  }

  return <AppAutenticado onSair={() => setAutenticado(false)} />;
}

export default App;
