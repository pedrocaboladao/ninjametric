import { useState } from "react";
import { Sidebar, type View } from "./components/Sidebar";
import { Dashboard } from "./components/Dashboard";
import { Perguntas } from "./components/Perguntas";
import { ClonarAnuncio } from "./components/ClonarAnuncio";
import { usePerguntas } from "./hooks/usePerguntas";
import "./App.css";

function App() {
  const [view, setView] = useState<View>("dashboard");
  const perguntas = usePerguntas();

  return (
    <div className="app-shell">
      <Sidebar view={view} onChangeView={setView} perguntasPendentes={perguntas.perguntas?.length ?? 0} />
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
      </main>
    </div>
  );
}

export default App;
