import type { ProdutoEstoqueBaixo } from "../types/dashboard";
import type { Loja } from "../api/lojas";

interface Props {
  produtos: ProdutoEstoqueBaixo[];
  lojas: Loja[];
  lojaFiltro: number | "todas" | "minhas";
  onChangeLojaFiltro: (valor: number | "todas" | "minhas") => void;
}

export function EstoqueBaixo({ produtos, lojas, lojaFiltro, onChangeLojaFiltro }: Props) {
  return (
    <div className="painel painel-top-vendidos">
      <div className="top-vendidos-header">
        <div>
          <span className="painel-eyebrow">Reposição</span>
          <h2>Produtos com estoque baixo</h2>
        </div>
        <div className="top-vendidos-header-direita">
          {produtos.length > 0 && (
            <span className="promo-badge promo-badge-alerta promo-resumo-alerta">{produtos.length} produtos</span>
          )}
          <select
            className="dashboard-select top-vendidos-select"
            value={lojaFiltro}
            onChange={(e) => {
              const valor = e.target.value;
              onChangeLojaFiltro(valor === "todas" || valor === "minhas" ? valor : Number(valor));
            }}
          >
            <option value="todas">Todas as lojas</option>
            <option value="minhas">Minhas lojas</option>
            {lojas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="top-vendidos-lista">
        {produtos.map((p) => (
          <a
            key={`${p.lojaId}:${p.itemId}`}
            className="top-vendido-item top-vendido-alerta"
            href={p.permalink ?? undefined}
            target="_blank"
            rel="noreferrer"
          >
            {p.thumbnail ? (
              <img className="produto-foto" src={p.thumbnail} alt="" loading="lazy" />
            ) : (
              <div className="produto-foto produto-foto-vazia" />
            )}
            <div className="top-vendido-info">
              <div className="produto-titulo" title={p.titulo}>
                {p.titulo}
              </div>
              <div className="produto-mlb">
                {p.lojaNome} · {p.itemId}
              </div>
            </div>
            <div className="top-vendido-badges">
              <span className="promo-badge promo-badge-alerta">{p.estoque} un.</span>
            </div>
          </a>
        ))}
        {produtos.length === 0 && <div className="state-message">Nenhum produto com estoque baixo por aqui.</div>}
      </div>
    </div>
  );
}
