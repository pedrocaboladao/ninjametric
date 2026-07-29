import { useState } from "react";
import {
  IconChart,
  IconQuestion,
  IconCopy,
  IconStore,
  IconTasks,
  IconBox,
  IconWand,
  IconUsers,
  IconGear,
  IconChevron,
} from "./icons";

export type View = "dashboard" | "perguntas" | "clonar";

interface Props {
  view: View;
  onChangeView: (view: View) => void;
  perguntasPendentes: number;
}

const INERTES = [
  { label: "Tarefas", Icon: IconTasks },
  { label: "Produtos", Icon: IconBox },
  { label: "Criação", Icon: IconWand },
  { label: "Equipe", Icon: IconUsers },
  { label: "Conta", Icon: IconGear },
];

export function Sidebar({ view, onChangeView, perguntasPendentes }: Props) {
  const [lojasAberta, setLojasAberta] = useState(true);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src="/logo-ninja-metrics-transparente.png" alt="Ninja Metrics" className="sidebar-logo" />
        <div className="sidebar-brand-sub">4 lojas · Mercado Livre</div>
      </div>

      <nav className="sidebar-nav">
        <button className="sidebar-group-toggle" onClick={() => setLojasAberta((v) => !v)}>
          <IconStore />
          <span>Lojas</span>
          <IconChevron open={lojasAberta} />
        </button>

        {lojasAberta && (
          <div className="sidebar-subitems">
            <button
              className={`sidebar-item ${view === "dashboard" ? "sidebar-item-ativo" : ""}`}
              onClick={() => onChangeView("dashboard")}
            >
              <IconChart size={16} />
              <span>Painel ao vivo</span>
            </button>
            <button
              className={`sidebar-item ${view === "perguntas" ? "sidebar-item-ativo" : ""}`}
              onClick={() => onChangeView("perguntas")}
            >
              <IconQuestion size={16} />
              <span>Perguntas</span>
              {perguntasPendentes > 0 && <span className="sidebar-badge">{perguntasPendentes}</span>}
            </button>
            <button
              className={`sidebar-item ${view === "clonar" ? "sidebar-item-ativo" : ""}`}
              onClick={() => onChangeView("clonar")}
            >
              <IconCopy size={16} />
              <span>Clonar Anúncio</span>
            </button>
          </div>
        )}

        <div className="sidebar-divider" />

        {INERTES.map(({ label, Icon }) => (
          <div key={label} className="sidebar-group-toggle sidebar-group-inerte">
            <Icon />
            <span>{label}</span>
            <em className="sidebar-em-breve">em breve</em>
          </div>
        ))}
      </nav>

      <div className="sidebar-user">
        <div className="sidebar-user-avatar">PD</div>
        <div className="sidebar-user-info">
          <div className="sidebar-user-nome">Pedro Dantas</div>
          <div className="sidebar-user-email">pedroroteirista@gmail.com</div>
        </div>
        <span className="sidebar-user-badge">DIRETOR</span>
      </div>
    </aside>
  );
}
