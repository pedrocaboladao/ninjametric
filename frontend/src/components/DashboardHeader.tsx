import type { Loja } from "../api/lojas";
import { formatAtualizadoEm } from "../utils/format";
import { IconClock, IconRefresh, IconExpand } from "./icons";

interface Props {
  lojas: Loja[];
  lojaFiltro: number | "todas";
  onChangeLojaFiltro: (valor: number | "todas") => void;
  atualizadoEm: Date | null;
  atualizando: boolean;
  onExpandir: () => void;
}

export function DashboardHeader({
  lojas,
  lojaFiltro,
  onChangeLojaFiltro,
  atualizadoEm,
  atualizando,
  onExpandir,
}: Props) {
  return (
    <div className="dashboard-topo">
      <div className="dashboard-topo-esquerda">
        <div className="dashboard-eyebrow-row">
          <span className="painel-eyebrow dashboard-eyebrow-solta">Lojas</span>
          <span className="dashboard-ao-vivo">
            <i className="hero-live-dot" /> Ao vivo
          </span>
        </div>
        <h1>Vendas de hoje ao vivo</h1>
        <div className="dashboard-status">
          <IconClock />
          {atualizadoEm ? <>Atualizado em {formatAtualizadoEm(atualizadoEm)}</> : "Carregando..."}
          {atualizando && (
            <span className="dashboard-status-atualizando">
              <IconRefresh size={12} spinning /> Atualizando
            </span>
          )}
        </div>
      </div>

      <div className="dashboard-topo-direita">
        <span className="dashboard-topo-label">Loja acompanhada</span>
        <div className="dashboard-topo-controles">
          <select
            className="dashboard-select"
            value={lojaFiltro}
            onChange={(e) => onChangeLojaFiltro(e.target.value === "todas" ? "todas" : Number(e.target.value))}
          >
            <option value="todas">Todas as lojas</option>
            {lojas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </select>
          <button className="dashboard-expand-btn" onClick={onExpandir} title="Tela cheia" type="button">
            <IconExpand />
          </button>
        </div>
      </div>
    </div>
  );
}
