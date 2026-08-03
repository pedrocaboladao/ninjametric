import type { RankingPrecificacao as RankingPrecificacaoTipo } from "../types/dashboard";
import type { Loja } from "../api/lojas";
import { formatCurrency, formatDataHora } from "../utils/format";

interface Props {
  ranking: RankingPrecificacaoTipo;
  lojas: Loja[];
  lojaFiltro: number | "todas" | "minhas";
  onChangeLojaFiltro: (valor: number | "todas" | "minhas") => void;
}

function classeMargem(margemPercentual: number): string {
  if (margemPercentual < 0) return "financeiro-margem-negativa";
  if (margemPercentual < 15) return "financeiro-margem-alerta";
  return "financeiro-margem-positiva";
}

export function RankingPrecificacao({ ranking, lojas, lojaFiltro, onChangeLojaFiltro }: Props) {
  return (
    <div className="painel painel-top-vendidos">
      <div className="top-vendidos-header">
        <div>
          <span className="painel-eyebrow">Vigilância de preço e margem</span>
          <h2>Fora do padrão do grupo (últimos 7 dias)</h2>
          <p className="painel-sub">
            Preço de venda real (não o do anúncio) — compara cada loja com o preço mais alto praticado pelo grupo
            pro mesmo SKU no período.
          </p>
        </div>
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

      <div className="precificacao-colunas">
        <div className="precificacao-coluna">
          <h3 className="precificacao-subtitulo">Menor preço do grupo</h3>
          <div className="top-vendidos-lista">
            {ranking.menorPreco.map((p) => (
              <div key={`${p.lojaId}-${p.sku}`} className="top-vendido-item top-vendido-alerta">
                <div className="top-vendido-info">
                  <div className="produto-titulo" title={p.titulo}>
                    {p.titulo}
                  </div>
                  <div className="produto-mlb">
                    {p.lojaNome} · SKU {p.sku}
                  </div>
                </div>
                <div className="precificacao-numeros">
                  <span className="financeiro-margem-negativa">{formatCurrency(p.precoLoja)}</span>
                  <span className="financeiro-td-mudo"> vs {formatCurrency(p.precoReferenciaGrupo)} do grupo</span>
                  <b className="financeiro-margem-negativa"> ({p.percentualAbaixo.toFixed(1)}% abaixo)</b>
                </div>
              </div>
            ))}
            {ranking.menorPreco.length === 0 && (
              <div className="state-message">Nenhum SKU vendido por mais de uma loja com preço divergente.</div>
            )}
          </div>
        </div>

        <div className="precificacao-coluna">
          <h3 className="precificacao-subtitulo">Menores margens</h3>
          <div className="top-vendidos-lista">
            {ranking.menorMargem.map((v, i) => (
              <div key={`${v.lojaId}-${v.sku}-${v.dataCriacao}-${i}`} className="top-vendido-item">
                <div className="top-vendido-info">
                  <div className="produto-titulo" title={v.titulo}>
                    {v.titulo}
                  </div>
                  <div className="produto-mlb">
                    {v.lojaNome} · {formatDataHora(v.dataCriacao)}
                  </div>
                </div>
                <div className="precificacao-numeros">
                  <b className={classeMargem(v.margemPercentual)}>{v.margemPercentual.toFixed(1)}%</b>
                  <span className="financeiro-td-mudo"> · {formatCurrency(v.receitaTotal)}</span>
                </div>
              </div>
            ))}
            {ranking.menorMargem.length === 0 && (
              <div className="state-message">Nenhuma venda com custo cadastrado no período.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
