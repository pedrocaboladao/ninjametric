import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchVendasFinanceirasShopee } from "../api/financeiroShopee";
import { fetchLojasShopee, type Loja } from "../api/lojas";
import type { VendaFinanceiraShopee, ResultadoFinanceiroShopee } from "../types/financeiroShopee";
import { formatCurrency, formatDataHora } from "../utils/format";
import { useBuscaComCancelamento } from "../hooks/useBuscaComCancelamento";

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

type ChaveOrdenacao =
  | "titulo"
  | "lojaNome"
  | "sku"
  | "orderSn"
  | "dataCriacao"
  | "valorUnitario"
  | "quantidade"
  | "receitaTotal"
  | "custoTotal"
  | "impostoTotal"
  | "taxaShopeeTotal"
  | "cupomVendedorTotal"
  | "margemContribuicao"
  | "margemPercentual";

interface Coluna {
  chave: ChaveOrdenacao;
  label: string;
  numerica?: boolean;
}

const COLUNAS: Coluna[] = [
  { chave: "titulo", label: "Anúncio" },
  { chave: "lojaNome", label: "Conta" },
  { chave: "sku", label: "SKU" },
  { chave: "orderSn", label: "Pedido" },
  { chave: "dataCriacao", label: "Data" },
  { chave: "valorUnitario", label: "Valor Unit.", numerica: true },
  { chave: "quantidade", label: "Qtd.", numerica: true },
  { chave: "receitaTotal", label: "Faturamento", numerica: true },
  { chave: "custoTotal", label: "Custo (-)", numerica: true },
  { chave: "impostoTotal", label: "Imposto (-)", numerica: true },
  { chave: "taxaShopeeTotal", label: "Taxa Shopee (-)", numerica: true },
  { chave: "cupomVendedorTotal", label: "Cupom (-)", numerica: true },
  { chave: "margemContribuicao", label: "Margem Contrib. (=)", numerica: true },
  { chave: "margemPercentual", label: "MC em %", numerica: true },
];

function valorOrdenacao(v: VendaFinanceiraShopee, chave: ChaveOrdenacao): number | string {
  if (chave === "dataCriacao") return new Date(v.dataCriacao).getTime();
  const bruto = v[chave] as unknown;
  if (bruto === null || bruto === undefined) return -Infinity;
  return bruto as number | string;
}

function comparar(a: VendaFinanceiraShopee, b: VendaFinanceiraShopee, chave: ChaveOrdenacao, direcao: 1 | -1): number {
  const va = valorOrdenacao(a, chave);
  const vb = valorOrdenacao(b, chave);
  if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * direcao;
  return ((va as number) - (vb as number)) * direcao;
}

export function FinanceiroShopee() {
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [lojaFiltro, setLojaFiltro] = useState<number | "todas" | "minhas">("todas");
  const [dataInicio, setDataInicio] = useState(() => hojeISO());
  const [dataFim, setDataFim] = useState(() => hojeISO());
  const [ordenacao, setOrdenacao] = useState<{ chave: ChaveOrdenacao; direcao: 1 | -1 }>({
    chave: "dataCriacao",
    direcao: -1,
  });

  useEffect(() => {
    fetchLojasShopee().then(setLojas).catch(() => {});
  }, []);

  const periodoValido = Boolean(dataInicio && dataFim && dataInicio <= dataFim);
  const buscarVendas = useCallback(
    (forcar: boolean) => fetchVendasFinanceirasShopee(lojaFiltro, dataInicio, dataFim, forcar),
    [lojaFiltro, dataInicio, dataFim]
  );
  const {
    dados: resultado,
    erro,
    atualizando,
    atualizarAgora,
  } = useBuscaComCancelamento<ResultadoFinanceiroShopee>(buscarVendas, periodoValido);

  const vendas = resultado?.vendas ?? null;
  const resumoPedidos = resultado?.resumoPedidos ?? null;
  const gastoAdsTotal = resultado?.gastoAdsTotal ?? 0;

  function ordenarPor(chave: ChaveOrdenacao) {
    setOrdenacao((atual) =>
      atual.chave === chave ? { chave, direcao: atual.direcao === 1 ? -1 : 1 } : { chave, direcao: 1 }
    );
  }

  const vendasOrdenadas = useMemo(() => {
    if (!vendas) return null;
    return [...vendas].sort((a, b) => comparar(a, b, ordenacao.chave, ordenacao.direcao));
  }, [vendas, ordenacao]);

  const comMargem = vendas?.filter((v) => v.margemContribuicao !== null) ?? [];
  const receitaTotal = vendas?.reduce((s, v) => s + v.receitaTotal, 0) ?? 0;
  const custoTotalGeral = vendas?.reduce((s, v) => s + (v.custoTotal ?? 0), 0) ?? 0;
  const impostoTotalGeral = vendas?.reduce((s, v) => s + v.impostoTotal, 0) ?? 0;
  const taxaShopeeTotalGeral = vendas?.reduce((s, v) => s + v.taxaShopeeTotal, 0) ?? 0;
  const cupomVendedorTotalGeral = vendas?.reduce((s, v) => s + v.cupomVendedorTotal, 0) ?? 0;
  const margemTotal = comMargem.reduce((s, v) => s + (v.margemContribuicao ?? 0), 0);
  const margemPercentualMedia = receitaTotal > 0 ? (margemTotal / receitaTotal) * 100 : null;
  const semCustoCadastrado = (vendas?.length ?? 0) - comMargem.length;

  // Gasto de Ads não é por venda (vem por dia, no nível da loja inteira) —
  // por isso só desconta aqui, no total da janela, igual ao Financeiro do ML.
  const margemAposAds = margemTotal - gastoAdsTotal;
  const margemAposAdsPercentual = receitaTotal > 0 ? (margemAposAds / receitaTotal) * 100 : null;

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <span className="painel-eyebrow">Financeiro</span>
          <h1>Feed de vendas — Shopee</h1>
          <p className="painel-sub">
            Receita, custo do produto, comissão + taxa de serviço da Shopee e imposto por venda. Ainda não desconta
            frete na margem — a Shopee não tem um "custo de frete do vendedor" isolado igual ao Mercado Livre nesse
            mesmo formato ainda mapeado.
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
            <button
              type="button"
              className="btn-responder financeiro-btn-hoje"
              onClick={() => {
                setDataInicio(diasAtrasISO(7));
                setDataFim(hojeISO());
              }}
            >
              7 dias
            </button>
            <button
              type="button"
              className="btn-responder financeiro-btn-hoje"
              onClick={atualizarAgora}
              disabled={atualizando}
              title="Buscar dados novos agora, sem esperar o cache"
            >
              {atualizando ? "Atualizando..." : "Atualizar"}
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
      {!erro && vendasOrdenadas === null && <div className="state-message">Carregando vendas...</div>}

      {vendasOrdenadas !== null && (
        <>
          {vendas && vendas.length > 0 && (
            <div className="financeiro-cards-cor">
              <div className="financeiro-card-cor financeiro-card-roxo">
                <div className="financeiro-card-cor-topo">
                  <span>Vendas</span>
                </div>
                <div className="financeiro-card-cor-corpo">
                  <span className="financeiro-card-cor-valor">{formatCurrency(receitaTotal)}</span>
                  <span className="financeiro-card-cor-sub">Faturamento Shopee</span>
                </div>
              </div>
              <div className="financeiro-card-cor financeiro-card-vermelho">
                <div className="financeiro-card-cor-topo">
                  <span>Custo, Imposto &amp; Taxa</span>
                </div>
                <div className="financeiro-card-cor-corpo">
                  <span className="financeiro-card-cor-valor">
                    {formatCurrency(custoTotalGeral + impostoTotalGeral + taxaShopeeTotalGeral + cupomVendedorTotalGeral)}
                  </span>
                  <div className="financeiro-card-cor-linha">
                    <span>Custo</span>
                    <b>{formatCurrency(custoTotalGeral)}</b>
                  </div>
                  <div className="financeiro-card-cor-linha">
                    <span>Imposto</span>
                    <b>{formatCurrency(impostoTotalGeral)}</b>
                  </div>
                  <div className="financeiro-card-cor-linha">
                    <span>Taxa Shopee</span>
                    <b>{formatCurrency(taxaShopeeTotalGeral)}</b>
                  </div>
                  <div className="financeiro-card-cor-linha">
                    <span>Cupom vendedor</span>
                    <b>{formatCurrency(cupomVendedorTotalGeral)}</b>
                  </div>
                </div>
              </div>
              <div className="financeiro-card-cor financeiro-card-verde">
                <div className="financeiro-card-cor-topo">
                  <span>Margem de Contribuição</span>
                </div>
                <div className="financeiro-card-cor-corpo">
                  <span className={`financeiro-card-cor-valor ${classeMargem(margemPercentualMedia)}`}>
                    {formatCurrency(margemTotal)}
                  </span>
                  {margemPercentualMedia !== null && (
                    <span className="financeiro-card-cor-sub">({margemPercentualMedia.toFixed(2)}%)</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {vendas && vendas.length > 0 && resumoPedidos && (
            <div className="financeiro-cards-secundarios">
              <div className="financeiro-stat-card">
                <span className="financeiro-stat-label">Qtd Vendas</span>
                <span className="financeiro-stat-valor">{resumoPedidos.pedidosAprovados}</span>
                <span className="financeiro-stat-sub">
                  Total: {resumoPedidos.totalPedidos} · Canceladas: {resumoPedidos.pedidosCancelados}
                </span>
                {semCustoCadastrado > 0 && (
                  <span className="financeiro-stat-sub">{semCustoCadastrado} sem custo cadastrado</span>
                )}
              </div>
              <div className="financeiro-stat-card">
                <span className="financeiro-stat-label">Margem após Ads</span>
                <span className={`financeiro-stat-valor ${classeMargem(margemAposAdsPercentual)}`}>
                  {formatCurrency(margemAposAds)}
                </span>
                <span className="financeiro-stat-sub">
                  Gasto Ads: {formatCurrency(gastoAdsTotal)}
                  {margemAposAdsPercentual !== null ? ` · ${margemAposAdsPercentual.toFixed(2)}%` : ""}
                </span>
              </div>
            </div>
          )}

          {vendasOrdenadas.length === 0 && (
            <div className="state-message">Nenhuma venda encontrada nesse período.</div>
          )}

          {vendasOrdenadas.length > 0 && (
            <div className="financeiro-tabela-wrap">
              <table className="financeiro-tabela">
                <thead>
                  <tr>
                    {COLUNAS.map((c) => (
                      <th
                        key={c.chave}
                        className={c.numerica ? "financeiro-th-numero" : ""}
                        onClick={() => ordenarPor(c.chave)}
                      >
                        {c.label} {ordenacao.chave === c.chave && (ordenacao.direcao === 1 ? "↑" : "↓")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vendasOrdenadas.map((v) => (
                    <tr key={`${v.orderSn}-${v.itemId}-${v.sku}`}>
                      <td className="financeiro-td-titulo" title={v.titulo}>
                        {v.titulo}
                      </td>
                      <td>{v.lojaNome}</td>
                      <td className="financeiro-td-sku">{v.sku ?? "—"}</td>
                      <td className="financeiro-td-sku">{v.orderSn}</td>
                      <td>{formatDataHora(v.dataCriacao)}</td>
                      <td className="financeiro-th-numero">{formatCurrency(v.valorUnitario)}</td>
                      <td className="financeiro-th-numero">{v.quantidade}</td>
                      <td className="financeiro-th-numero">{formatCurrency(v.receitaTotal)}</td>
                      <td className="financeiro-th-numero financeiro-td-custo">
                        {v.custoTotal !== null ? formatCurrency(v.custoTotal) : "—"}
                      </td>
                      <td className="financeiro-th-numero financeiro-td-custo">{formatCurrency(v.impostoTotal)}</td>
                      <td className="financeiro-th-numero financeiro-td-custo">{formatCurrency(v.taxaShopeeTotal)}</td>
                      <td className="financeiro-th-numero financeiro-td-custo">{formatCurrency(v.cupomVendedorTotal)}</td>
                      <td className={`financeiro-th-numero financeiro-linha-margem ${classeMargem(v.margemPercentual)}`}>
                        {v.margemContribuicao !== null ? formatCurrency(v.margemContribuicao) : "não cadastrado"}
                      </td>
                      <td className={`financeiro-th-numero financeiro-linha-margem ${classeMargem(v.margemPercentual)}`}>
                        {v.margemPercentual !== null ? `${v.margemPercentual.toFixed(2)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
