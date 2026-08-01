import { useEffect, useState } from "react";
import { fetchVendasFinanceiras } from "../api/financeiro";
import { fetchLojas, type Loja } from "../api/lojas";
import type { VendaFinanceira } from "../types/financeiro";
import { formatCurrency, formatDataHora } from "../utils/format";

function classeMargem(margemPercentual: number | null): string {
  if (margemPercentual === null) return "financeiro-margem-neutra";
  if (margemPercentual < 0) return "financeiro-margem-negativa";
  if (margemPercentual < 15) return "financeiro-margem-alerta";
  return "financeiro-margem-positiva";
}

function dataISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hojeISO(): string {
  return dataISO(new Date());
}

function diasAtrasISO(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return dataISO(d);
}

export function Financeiro() {
  const [vendas, setVendas] = useState<VendaFinanceira[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [lojaFiltro, setLojaFiltro] = useState<number | "todas" | "minhas">("todas");
  const [dataInicio, setDataInicio] = useState(() => diasAtrasISO(7));
  const [dataFim, setDataFim] = useState(() => hojeISO());

  useEffect(() => {
    fetchLojas().then(setLojas).catch(() => {});
  }, []);

  useEffect(() => {
    if (!dataInicio || !dataFim || dataInicio > dataFim) return;
    setVendas(null);
    setErro(null);
    fetchVendasFinanceiras(lojaFiltro, dataInicio, dataFim)
      .then(setVendas)
      .catch((err) => setErro(err instanceof Error ? err.message : "Falha ao carregar vendas."));
  }, [lojaFiltro, dataInicio, dataFim]);

  const comMargem = vendas?.filter((v) => v.margemContribuicao !== null) ?? [];
  const receitaTotal = vendas?.reduce((s, v) => s + v.receitaTotal, 0) ?? 0;
  const margemTotal = comMargem.reduce((s, v) => s + (v.margemContribuicao ?? 0), 0);
  const margemPercentualMedia = receitaTotal > 0 ? (margemTotal / receitaTotal) * 100 : null;

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <span className="painel-eyebrow">Financeiro</span>
          <h1>Feed de vendas</h1>
          <p className="painel-sub">
            Receita, custo do produto, comissão do Mercado Livre e frete por venda. Não inclui custo fixo (aluguel,
            salários etc.).
          </p>
        </div>
        <div className="financeiro-filtros">
          <div className="financeiro-filtro-datas">
            <input
              type="date"
              className="dashboard-select"
              value={dataInicio}
              max={dataFim}
              onChange={(e) => setDataInicio(e.target.value)}
            />
            <span>até</span>
            <input
              type="date"
              className="dashboard-select"
              value={dataFim}
              min={dataInicio}
              max={hojeISO()}
              onChange={(e) => setDataFim(e.target.value)}
            />
            <button
              type="button"
              className="btn-responder financeiro-btn-hoje"
              onClick={() => {
                setDataInicio(hojeISO());
                setDataFim(hojeISO());
              }}
            >
              Hoje
            </button>
          </div>
          <select
            className="dashboard-select"
            value={lojaFiltro}
            onChange={(e) => {
              const valor = e.target.value;
              setLojaFiltro(valor === "todas" || valor === "minhas" ? valor : Number(valor));
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

      {erro && <div className="state-message state-error">{erro}</div>}
      {!erro && vendas === null && <div className="state-message">Carregando vendas...</div>}

      {vendas !== null && (
        <>
          {vendas.length > 0 && (
            <div className="financeiro-resumo">
              <div className="financeiro-resumo-item">
                <span className="financeiro-resumo-label">Receita</span>
                <span className="financeiro-resumo-valor">{formatCurrency(receitaTotal)}</span>
              </div>
              <div className="financeiro-resumo-item">
                <span className="financeiro-resumo-label">Margem de contribuição</span>
                <span className={`financeiro-resumo-valor ${classeMargem(margemPercentualMedia)}`}>
                  {formatCurrency(margemTotal)}
                  {margemPercentualMedia !== null && ` (${margemPercentualMedia.toFixed(1)}%)`}
                </span>
              </div>
              {comMargem.length < vendas.length && (
                <div className="financeiro-resumo-item">
                  <span className="financeiro-resumo-label">Sem custo cadastrado</span>
                  <span className="financeiro-resumo-valor">{vendas.length - comMargem.length} vendas</span>
                </div>
              )}
            </div>
          )}

          {vendas.length === 0 && <div className="state-message">Nenhuma venda no período selecionado.</div>}

          <div className="financeiro-feed">
            {vendas.map((v) => (
              <div key={`${v.orderId}-${v.sku}`} className="financeiro-linha">
                <div className="financeiro-linha-data">{formatDataHora(v.dataCriacao)}</div>
                <div className="financeiro-linha-produto">
                  <div className="financeiro-linha-titulo" title={v.titulo}>
                    {v.titulo}
                  </div>
                  <div className="financeiro-linha-sub">
                    {v.lojaNome} · {v.sku ?? "sem SKU"} · qtd {v.quantidade}
                  </div>
                </div>
                <div className="financeiro-linha-valor">
                  <span className="financeiro-linha-label">Receita</span>
                  {formatCurrency(v.receitaTotal)}
                </div>
                <div className="financeiro-linha-valor">
                  <span className="financeiro-linha-label">Custo</span>
                  {v.custoTotal !== null ? formatCurrency(v.custoTotal) : "—"}
                </div>
                <div className="financeiro-linha-valor">
                  <span className="financeiro-linha-label">Taxa ML</span>
                  {formatCurrency(v.taxaMlTotal)}
                </div>
                <div className="financeiro-linha-valor">
                  <span className="financeiro-linha-label">Frete</span>
                  {v.freteTotal !== null ? formatCurrency(v.freteTotal) : "—"}
                </div>
                <div className={`financeiro-linha-valor financeiro-linha-margem ${classeMargem(v.margemPercentual)}`}>
                  <span className="financeiro-linha-label">Margem</span>
                  {v.margemContribuicao !== null
                    ? `${formatCurrency(v.margemContribuicao)} (${v.margemPercentual?.toFixed(1)}%)`
                    : "não cadastrado"}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
