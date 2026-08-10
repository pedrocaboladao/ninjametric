import type { AnuncioNegativo } from "../types/dashboard";
import type { Loja } from "../api/lojas";
import { formatCurrency } from "../utils/format";

interface Props {
  anuncios: AnuncioNegativo[];
  lojas: Loja[];
  lojaFiltro: number | "todas" | "minhas";
  onChangeLojaFiltro: (valor: number | "todas" | "minhas") => void;
}

export function AnunciosNegativos({ anuncios, lojas, lojaFiltro, onChangeLojaFiltro }: Props) {
  return (
    <div className="painel painel-top-vendidos">
      <div className="top-vendidos-header">
        <div>
          <span className="painel-eyebrow">Financeiro</span>
          <h2>Anúncios com margem negativa</h2>
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
        Preço atual (considerando promoção ativa, se tiver) já nasce abaixo de custo + taxa do ML + imposto — antes
        mesmo de vender de novo. Não considera frete (só existe depois de um pedido real), então a margem de uma
        venda pode ficar ainda pior do que a estimativa aqui.
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
                {a.lojaNome} · {a.emPromocao ? "em promoção" : "preço normal"} · vende a {formatCurrency(a.precoEfetivo)}
              </div>
              <div className="produto-mlb">
                custo {formatCurrency(a.custoUnitario)} · taxa ML {formatCurrency(a.taxaMl)} ·{" "}
                {a.margemPercentual.toFixed(1)}% de margem
              </div>
            </div>
            <div className="top-vendido-badges">
              <span className="promo-badge promo-badge-alerta">{formatCurrency(a.margemEstimada)}</span>
            </div>
          </a>
        ))}
        {anuncios.length === 0 && <div className="state-message">Nenhum anúncio com margem negativa por aqui.</div>}
      </div>
    </div>
  );
}
