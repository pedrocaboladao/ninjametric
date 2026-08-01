import { useEffect, useState } from "react";
import { fetchVendasFinanceiras } from "../api/financeiro";
import { fetchLojas, fetchLojasTodas, atualizarImpostoLoja, type Loja, type LojaTodas } from "../api/lojas";
import type { VendaFinanceira } from "../types/financeiro";
import type { Usuario } from "../types/usuarios";
import { formatCurrency, formatDataHora } from "../utils/format";

interface Props {
  usuario: Usuario;
}

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

function GerenciarImpostos({ onFechar }: { onFechar: () => void }) {
  const [lojas, setLojas] = useState<LojaTodas[] | null>(null);
  const [valores, setValores] = useState<Record<number, string>>({});
  const [salvandoId, setSalvandoId] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetchLojasTodas()
      .then((ls) => {
        setLojas(ls);
        setValores(Object.fromEntries(ls.map((l) => [l.id, String(l.impostoPercentual)])));
      })
      .catch((err) => setErro(err instanceof Error ? err.message : "Falha ao carregar lojas."));
  }, []);

  async function salvar(id: number) {
    const valor = Number(valores[id]?.replace(",", "."));
    if (Number.isNaN(valor) || valor < 0 || valor > 100) {
      setErro("Informe um percentual entre 0 e 100.");
      return;
    }
    setSalvandoId(id);
    setErro(null);
    try {
      await atualizarImpostoLoja(id, valor);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setSalvandoId(null);
    }
  }

  return (
    <div className="financeiro-impostos">
      <div className="financeiro-impostos-header">
        <span>Imposto por loja</span>
        <button type="button" className="btn-excluir" onClick={onFechar}>
          Fechar
        </button>
      </div>
      {erro && <div className="state-message state-error">{erro}</div>}
      {lojas === null && <div className="state-message">Carregando...</div>}
      {lojas?.map((l) => (
        <div key={l.id} className="financeiro-impostos-linha">
          <span>{l.nome}</span>
          <div className="financeiro-impostos-campo">
            <input
              type="text"
              inputMode="decimal"
              className="clonar-input"
              value={valores[l.id] ?? ""}
              onChange={(e) => setValores((v) => ({ ...v, [l.id]: e.target.value }))}
            />
            <span>%</span>
            <button
              type="button"
              className="btn-responder"
              disabled={salvandoId === l.id}
              onClick={() => salvar(l.id)}
            >
              {salvandoId === l.id ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Financeiro({ usuario }: Props) {
  const [vendas, setVendas] = useState<VendaFinanceira[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [lojaFiltro, setLojaFiltro] = useState<number | "todas" | "minhas">("todas");
  const [dataInicio, setDataInicio] = useState(() => diasAtrasISO(7));
  const [dataFim, setDataFim] = useState(() => hojeISO());
  const [gerenciandoImpostos, setGerenciandoImpostos] = useState(false);

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
  const custoTotalGeral = vendas?.reduce((s, v) => s + (v.custoTotal ?? 0), 0) ?? 0;
  const taxaMlTotalGeral = vendas?.reduce((s, v) => s + v.taxaMlTotal, 0) ?? 0;
  const freteTotalGeral = vendas?.reduce((s, v) => s + (v.freteTotal ?? 0), 0) ?? 0;
  const impostoTotalGeral = vendas?.reduce((s, v) => s + v.impostoTotal, 0) ?? 0;
  const margemTotal = comMargem.reduce((s, v) => s + (v.margemContribuicao ?? 0), 0);
  const margemPercentualMedia = receitaTotal > 0 ? (margemTotal / receitaTotal) * 100 : null;

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <span className="painel-eyebrow">Financeiro</span>
          <h1>Feed de vendas</h1>
          <p className="painel-sub">
            Receita, custo do produto, comissão do Mercado Livre, frete e imposto por venda. Não inclui custo fixo
            (aluguel, salários etc.).
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
          {usuario.admin && (
            <button
              type="button"
              className="painel-estudo-gerenciar-btn"
              onClick={() => setGerenciandoImpostos((g) => !g)}
            >
              {gerenciandoImpostos ? "Fechar" : "Imposto por loja"}
            </button>
          )}
        </div>
      </div>

      {gerenciandoImpostos && usuario.admin && <GerenciarImpostos onFechar={() => setGerenciandoImpostos(false)} />}

      {erro && <div className="state-message state-error">{erro}</div>}
      {!erro && vendas === null && <div className="state-message">Carregando vendas...</div>}

      {vendas !== null && (
        <>
          {vendas.length > 0 && (
            <div className="financeiro-stats">
              <div className="financeiro-stat-card">
                <span className="financeiro-stat-label">Receita</span>
                <span className="financeiro-stat-valor">{formatCurrency(receitaTotal)}</span>
                <span className="financeiro-stat-sub">{vendas.length} vendas</span>
              </div>
              <div className="financeiro-stat-card">
                <span className="financeiro-stat-label">Custo dos produtos</span>
                <span className="financeiro-stat-valor">{formatCurrency(custoTotalGeral)}</span>
              </div>
              <div className="financeiro-stat-card">
                <span className="financeiro-stat-label">Taxa Mercado Livre</span>
                <span className="financeiro-stat-valor">{formatCurrency(taxaMlTotalGeral)}</span>
              </div>
              <div className="financeiro-stat-card">
                <span className="financeiro-stat-label">Frete</span>
                <span className="financeiro-stat-valor">{formatCurrency(freteTotalGeral)}</span>
              </div>
              <div className="financeiro-stat-card">
                <span className="financeiro-stat-label">Imposto</span>
                <span className="financeiro-stat-valor">{formatCurrency(impostoTotalGeral)}</span>
              </div>
              <div className="financeiro-stat-card financeiro-stat-card-destaque">
                <span className="financeiro-stat-label">Margem de contribuição</span>
                <span className={`financeiro-stat-valor financeiro-stat-valor-grande ${classeMargem(margemPercentualMedia)}`}>
                  {formatCurrency(margemTotal)}
                </span>
                {margemPercentualMedia !== null && (
                  <span className={`financeiro-stat-sub ${classeMargem(margemPercentualMedia)}`}>
                    {margemPercentualMedia >= 0 ? "↗" : "↘"} {margemPercentualMedia.toFixed(1)}% da receita
                  </span>
                )}
                {comMargem.length < vendas.length && (
                  <span className="financeiro-stat-sub">{vendas.length - comMargem.length} sem custo cadastrado</span>
                )}
              </div>
            </div>
          )}

          {vendas.length === 0 && <div className="state-message">Nenhuma venda no período selecionado.</div>}

          {vendas.length > 0 && (
            <div className="financeiro-feed">
              <div className="financeiro-linha financeiro-linha-header">
                <span>Data</span>
                <span>Produto</span>
                <span>Receita</span>
                <span>Custo</span>
                <span>Taxa ML</span>
                <span>Frete</span>
                <span>Imposto</span>
                <span>Margem</span>
              </div>
              {vendas.map((v) => (
                <div key={`${v.orderId}-${v.sku}`} className="financeiro-linha">
                  <span className="financeiro-linha-data">{formatDataHora(v.dataCriacao)}</span>
                  <div className="financeiro-linha-produto">
                    <div className="financeiro-linha-titulo" title={v.titulo}>
                      {v.titulo}
                    </div>
                    <div className="financeiro-linha-sub">
                      {v.lojaNome} · {v.sku ?? "sem SKU"} · qtd {v.quantidade}
                    </div>
                  </div>
                  <span>{formatCurrency(v.receitaTotal)}</span>
                  <span>{v.custoTotal !== null ? formatCurrency(v.custoTotal) : "—"}</span>
                  <span>{formatCurrency(v.taxaMlTotal)}</span>
                  <span>{v.freteTotal !== null ? formatCurrency(v.freteTotal) : "—"}</span>
                  <span>{formatCurrency(v.impostoTotal)}</span>
                  <span className={`financeiro-linha-margem ${classeMargem(v.margemPercentual)}`}>
                    {v.margemContribuicao !== null
                      ? `${formatCurrency(v.margemContribuicao)} (${v.margemPercentual?.toFixed(1)}%)`
                      : "não cadastrado"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
