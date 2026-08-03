import { useState } from "react";
import type { RankingPrecificacao as RankingPrecificacaoTipo, ComparacaoSkuLoja } from "../types/dashboard";
import type { Loja } from "../api/lojas";
import { fetchComparacaoPorSku } from "../api/dashboard";
import { formatCurrency, formatDataHora } from "../utils/format";

interface Props {
  ranking: RankingPrecificacaoTipo;
  lojas: Loja[];
  lojaFiltro: number | "todas" | "minhas";
  onChangeLojaFiltro: (valor: number | "todas" | "minhas") => void;
  modoData: "hoje" | "7dias";
  onChangeModoData: (valor: "hoje" | "7dias") => void;
  dataInicio: string;
  dataFim: string;
}

type Aba = "preco" | "margem";

function classeMargem(margemPercentual: number | null): string {
  if (margemPercentual === null) return "financeiro-margem-neutra";
  if (margemPercentual < 0) return "financeiro-margem-negativa";
  if (margemPercentual < 15) return "financeiro-margem-alerta";
  return "financeiro-margem-positiva";
}

export function RankingPrecificacao({
  ranking,
  lojas,
  lojaFiltro,
  onChangeLojaFiltro,
  modoData,
  onChangeModoData,
  dataInicio,
  dataFim,
}: Props) {
  const [aba, setAba] = useState<Aba>("preco");
  const [buscaSku, setBuscaSku] = useState("");
  const [resultadoBusca, setResultadoBusca] = useState<ComparacaoSkuLoja[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState<string | null>(null);

  function buscar() {
    const sku = buscaSku.trim();
    if (!sku) return;
    setBuscando(true);
    setErroBusca(null);
    fetchComparacaoPorSku(sku, lojaFiltro === "todas" ? undefined : lojaFiltro, dataInicio, dataFim)
      .then(setResultadoBusca)
      .catch((err) => setErroBusca(err instanceof Error ? err.message : "Falha ao buscar SKU."))
      .finally(() => setBuscando(false));
  }

  function limparBusca() {
    setBuscaSku("");
    setResultadoBusca(null);
    setErroBusca(null);
  }

  return (
    <div className="painel painel-top-vendidos">
      <div className="top-vendidos-header">
        <div>
          <span className="painel-eyebrow">Vigilância de preço e margem</span>
          <h2>Fora do padrão do grupo ({modoData === "hoje" ? "hoje" : "7 dias"})</h2>
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

      <div className="precificacao-abas">
        <button
          type="button"
          className={`precificacao-aba ${modoData === "hoje" ? "precificacao-aba-ativa" : ""}`}
          onClick={() => onChangeModoData("hoje")}
        >
          Hoje
        </button>
        <button
          type="button"
          className={`precificacao-aba ${modoData === "7dias" ? "precificacao-aba-ativa" : ""}`}
          onClick={() => onChangeModoData("7dias")}
        >
          7 dias
        </button>
      </div>

      <div className="precificacao-busca">
        <input
          type="text"
          className="dashboard-select"
          placeholder="Buscar por SKU específico..."
          value={buscaSku}
          onChange={(e) => setBuscaSku(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") buscar();
          }}
        />
        <button type="button" className="btn-responder" onClick={buscar} disabled={buscando || !buscaSku.trim()}>
          {buscando ? "..." : "Buscar"}
        </button>
        {resultadoBusca !== null && (
          <button type="button" className="btn-excluir" onClick={limparBusca}>
            Limpar
          </button>
        )}
      </div>

      {erroBusca && <div className="state-message state-error">{erroBusca}</div>}

      {resultadoBusca === null && (
        <div className="precificacao-abas">
          <button
            type="button"
            className={`precificacao-aba ${aba === "preco" ? "precificacao-aba-ativa" : ""}`}
            onClick={() => setAba("preco")}
            title="Ordenado pelo impacto estimado (diferença de preço × quantidade vendida) — não só pelo % de desconto isolado, pra priorizar quem realmente está puxando o mercado pra baixo."
          >
            Menor preço
          </button>
          <button
            type="button"
            className={`precificacao-aba ${aba === "margem" ? "precificacao-aba-ativa" : ""}`}
            onClick={() => setAba("margem")}
          >
            Menores margens
          </button>
        </div>
      )}

      {resultadoBusca !== null ? (
        <div className="top-vendidos-lista">
          {resultadoBusca.map((c) => (
            <div key={`${c.lojaId}`} className="top-vendido-item">
              <div className="top-vendido-info">
                <div className="produto-titulo" title={c.titulo}>
                  {c.titulo}
                </div>
                <div className="produto-mlb">
                  {c.lojaNome} · {c.quantidadeVendida} unid.
                </div>
              </div>
              <div className="precificacao-numeros">
                <b>{formatCurrency(c.precoMedio)}</b>
                <span className={classeMargem(c.margemPercentualMedia)}>
                  {" "}
                  · {c.margemPercentualMedia !== null ? `${c.margemPercentualMedia.toFixed(1)}%` : "—"}
                </span>
              </div>
            </div>
          ))}
          {resultadoBusca.length === 0 && <div className="state-message">Nenhuma venda desse SKU no período.</div>}
        </div>
      ) : aba === "preco" ? (
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
              <div className="precificacao-numeros precificacao-numeros-multilinha">
                <div>
                  <b className="financeiro-margem-negativa">{formatCurrency(p.impactoEstimado)}</b>
                  <span className="financeiro-td-mudo"> impacto</span>
                  <span className={classeMargem(p.margemPercentual)}>
                    {" "}
                    · margem {p.margemPercentual !== null ? `${p.margemPercentual.toFixed(1)}%` : "—"}
                  </span>
                </div>
                <div className="financeiro-td-mudo precificacao-detalhe">
                  {p.quantidadeVendida} un. · {formatCurrency(p.precoLoja)} vs {formatCurrency(p.precoReferenciaGrupo)} (-
                  {p.percentualAbaixo.toFixed(0)}%)
                </div>
              </div>
            </div>
          ))}
          {ranking.menorPreco.length === 0 && (
            <div className="state-message">Nenhum SKU vendido por mais de uma loja com preço divergente.</div>
          )}
        </div>
      ) : (
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
      )}
    </div>
  );
}
