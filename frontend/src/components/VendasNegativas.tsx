import type { VendaNegativa } from "../types/dashboard";
import type { Loja } from "../api/lojas";
import { formatCurrency, formatDataHora } from "../utils/format";

interface Props {
  vendas: VendaNegativa[];
  lojas: Loja[];
  lojaFiltro: number | "todas" | "minhas";
  onChangeLojaFiltro: (valor: number | "todas" | "minhas") => void;
}

// ML resolve o anúncio só com o ID, sem precisar do slug descritivo — mas
// exige o hífen depois do prefixo "MLB" (a API devolve sem hífen).
function mlbParaUrl(itemId: string): string {
  return `https://produto.mercadolivre.com.br/${itemId.replace(/^(MLB)(\d)/, "$1-$2")}`;
}

export function VendasNegativas({ vendas, lojas, lojaFiltro, onChangeLojaFiltro }: Props) {
  return (
    <div className="painel painel-top-vendidos">
      <div className="top-vendidos-header">
        <div>
          <span className="painel-eyebrow">Financeiro</span>
          <h2>Vendas no prejuízo (últimos 7 dias)</h2>
        </div>
        <div className="top-vendidos-header-direita">
          {vendas.length > 0 && (
            <span className="promo-badge promo-badge-alerta promo-resumo-alerta">{vendas.length} vendas</span>
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
        {vendas.map((v) => (
          <a
            key={`${v.orderId}-${v.itemId}`}
            className="top-vendido-item top-vendido-alerta"
            href={mlbParaUrl(v.itemId)}
            target="_blank"
            rel="noreferrer"
          >
            <div className="top-vendido-info">
              <div className="produto-titulo" title={v.titulo}>
                {v.titulo}
              </div>
              <div className="produto-mlb">
                {v.lojaNome} · {formatDataHora(v.dataCriacao)} · vendeu {formatCurrency(v.receitaTotal)}
              </div>
              <div className="produto-mlb">
                custo {v.custoTotal !== null ? formatCurrency(v.custoTotal) : "—"} · taxa ML{" "}
                {formatCurrency(v.taxaMlTotal)} · frete{" "}
                {v.freteVendedorTotal !== null ? formatCurrency(v.freteVendedorTotal) : "—"} · imposto{" "}
                {formatCurrency(v.impostoTotal)}
              </div>
            </div>
            <div className="top-vendido-badges">
              <span className="promo-badge promo-badge-alerta">{formatCurrency(v.margemContribuicao)}</span>
            </div>
          </a>
        ))}
        {vendas.length === 0 && <div className="state-message">Nenhuma venda no prejuízo por aqui.</div>}
      </div>
    </div>
  );
}
