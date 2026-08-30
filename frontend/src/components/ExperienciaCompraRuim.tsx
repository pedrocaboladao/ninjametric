import type { ExperienciaCompraRuim as ExperienciaCompraRuimItem } from "../types/dashboard";
import type { Loja } from "../api/lojas";

interface Props {
  anuncios: ExperienciaCompraRuimItem[];
  lojas: Loja[];
  lojaFiltro: number | "todas" | "minhas";
  onChangeLojaFiltro: (valor: number | "todas" | "minhas") => void;
}

export function ExperienciaCompraRuim({ anuncios, lojas, lojaFiltro, onChangeLojaFiltro }: Props) {
  return (
    <div className="painel painel-top-vendidos">
      <div className="top-vendidos-header">
        <div>
          <span className="painel-eyebrow">Reputação</span>
          <h2>Experiência de Compra ruim</h2>
        </div>
        <div className="top-vendidos-header-direita">
          {anuncios.length > 0 && (
            <span className="promo-badge promo-badge-alerta promo-resumo-alerta">{anuncios.length} anúncios</span>
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

      <p className="painel-sub">
        Anúncio com pouca venda herda a nota dos outros anúncios da mesma categoria — corrigir ou pausar o pior
        anúncio de uma categoria pode salvar a nota de todo o resto dela.
      </p>

      <div className="top-vendidos-lista">
        {anuncios.map((a) => (
          <a
            key={`${a.lojaId}-${a.itemId}`}
            className="top-vendido-item top-vendido-alerta"
            href={a.permalink ?? "#"}
            target="_blank"
            rel="noreferrer"
          >
            <div className="top-vendido-info">
              <div className="produto-titulo" title={a.titulo}>
                {a.titulo}
              </div>
              <div className="produto-mlb">
                {a.lojaNome} · {a.sku ?? "sem SKU"}
              </div>
              <div className="produto-mlb">{a.recomendacaoTexto ?? a.motivoTexto ?? "Sem detalhe adicional."}</div>
            </div>
            <div className="top-vendido-badges">
              <span className="promo-badge promo-badge-alerta">{a.reputationText ?? `${a.reputationValue}`}</span>
            </div>
          </a>
        ))}
        {anuncios.length === 0 && (
          <div className="state-message">Nenhum anúncio com Experiência de Compra ruim por aqui.</div>
        )}
      </div>
    </div>
  );
}
