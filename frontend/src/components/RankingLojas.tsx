import type { RankingLoja } from "../types/dashboard";
import { formatCurrency, corDaLoja } from "../utils/format";

interface Props {
  lojas: RankingLoja[];
}

export function RankingLojas({ lojas }: Props) {
  return (
    <div className="painel">
      <span className="painel-eyebrow">Desempenho por loja</span>
      <h2>Ranking de faturamento</h2>
      <p className="painel-sub">Vendas confirmadas até o momento</p>

      <div className="ranking-header-row">
        <span>{lojas.length} lojas no ranking</span>
        <span>Participação no total</span>
      </div>

      <div className="ranking-lista">
        {lojas.map((r, i) => (
          <div className={`ranking-item ${i < lojas.length - 1 ? "ranking-item-separado" : ""}`} key={r.lojaId}>
            <div className="ranking-item-topo">
              <span className={`ranking-posicao ${i === 0 ? "ranking-posicao-primeiro" : ""}`}>{i + 1}</span>
              <i className="ranking-dot" style={{ background: corDaLoja(r.lojaId) }} />
              <div className="ranking-info">
                <div className="ranking-nome">{r.lojaNome}</div>
                <div className="ranking-meta">
                  {r.numVendas} vendas · {r.numUnidades} un.
                </div>
              </div>
              <div className="ranking-valores">
                <div className="ranking-valor">{formatCurrency(r.valor)}</div>
                <div className="ranking-percentual">{r.percentualDoTotal.toFixed(1)}% do total</div>
              </div>
            </div>
            <div className="ranking-barra-track">
              <div
                className="ranking-barra-fill"
                style={{ width: `${r.percentualDoTotal}%`, background: corDaLoja(r.lojaId) }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
