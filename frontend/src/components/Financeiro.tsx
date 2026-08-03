import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchVendasFinanceiras, fetchPontoEquilibrio } from "../api/financeiro";
import {
  fetchLojas,
  fetchLojasTodas,
  atualizarImpostoLoja,
  atualizarCustoFixoLoja,
  type Loja,
  type LojaTodas,
} from "../api/lojas";
import type { VendaFinanceira, ResultadoFinanceiro, PontoEquilibrio } from "../types/financeiro";
import type { Usuario } from "../types/usuarios";
import { formatCurrency, formatDataHora } from "../utils/format";
import { useBuscaComCancelamento } from "../hooks/useBuscaComCancelamento";

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

type ChaveOrdenacao =
  | "titulo"
  | "lojaNome"
  | "sku"
  | "dataCriacao"
  | "valorUnitario"
  | "quantidade"
  | "receitaTotal"
  | "custoTotal"
  | "impostoTotal"
  | "taxaMlTotal"
  | "freteCompradorTotal"
  | "freteVendedorTotal"
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
  { chave: "dataCriacao", label: "Data" },
  { chave: "valorUnitario", label: "Valor Unit.", numerica: true },
  { chave: "quantidade", label: "Qtd.", numerica: true },
  { chave: "receitaTotal", label: "Faturamento ML", numerica: true },
  { chave: "custoTotal", label: "Custo (-)", numerica: true },
  { chave: "impostoTotal", label: "Imposto (-)", numerica: true },
  { chave: "taxaMlTotal", label: "Tarifa de Venda (-)", numerica: true },
  { chave: "freteCompradorTotal", label: "Frete Comprador (-)", numerica: true },
  { chave: "freteVendedorTotal", label: "Frete Vendedor (-)", numerica: true },
  { chave: "margemContribuicao", label: "Margem Contrib. (=)", numerica: true },
  { chave: "margemPercentual", label: "MC em %", numerica: true },
];

function valorOrdenacao(v: VendaFinanceira, chave: ChaveOrdenacao): number | string {
  if (chave === "dataCriacao") return new Date(v.dataCriacao).getTime();
  const bruto = v[chave] as unknown;
  if (bruto === null || bruto === undefined) return -Infinity;
  return bruto as number | string;
}

function comparar(a: VendaFinanceira, b: VendaFinanceira, chave: ChaveOrdenacao, direcao: 1 | -1): number {
  const va = valorOrdenacao(a, chave);
  const vb = valorOrdenacao(b, chave);
  if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * direcao;
  return ((va as number) - (vb as number)) * direcao;
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

function GerenciarCustoFixo({ onFechar }: { onFechar: () => void }) {
  const [lojas, setLojas] = useState<LojaTodas[] | null>(null);
  const [valores, setValores] = useState<Record<number, string>>({});
  const [salvandoId, setSalvandoId] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetchLojasTodas()
      .then((ls) => {
        setLojas(ls);
        setValores(Object.fromEntries(ls.map((l) => [l.id, String(l.custoFixoMensal)])));
      })
      .catch((err) => setErro(err instanceof Error ? err.message : "Falha ao carregar lojas."));
  }, []);

  async function salvar(id: number) {
    const valor = Number(valores[id]?.replace(",", "."));
    if (Number.isNaN(valor) || valor < 0) {
      setErro("Informe um valor válido.");
      return;
    }
    setSalvandoId(id);
    setErro(null);
    try {
      await atualizarCustoFixoLoja(id, valor);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setSalvandoId(null);
    }
  }

  return (
    <div className="financeiro-impostos">
      <div className="financeiro-impostos-header">
        <span>Custo fixo mensal por loja</span>
        <button type="button" className="btn-excluir" onClick={onFechar}>
          Fechar
        </button>
      </div>
      <p className="painel-sub">Aluguel, salários etc. — cada loja é um negócio próprio, com o seu.</p>
      {erro && <div className="state-message state-error">{erro}</div>}
      {lojas === null && <div className="state-message">Carregando...</div>}
      {lojas?.map((l) => (
        <div key={l.id} className="financeiro-impostos-linha">
          <span>{l.nome}</span>
          <div className="financeiro-impostos-campo">
            <span>R$</span>
            <input
              type="text"
              inputMode="decimal"
              className="clonar-input"
              value={valores[l.id] ?? ""}
              onChange={(e) => setValores((v) => ({ ...v, [l.id]: e.target.value }))}
            />
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

function PontoEquilibrioCard({ lojaFiltro }: { lojaFiltro: number | "todas" | "minhas" }) {
  const buscar = useCallback(() => fetchPontoEquilibrio(lojaFiltro), [lojaFiltro]);
  const { dados, erro } = useBuscaComCancelamento<PontoEquilibrio>(buscar, true);

  if (erro) return <div className="state-message state-error">{erro}</div>;
  if (!dados) return <div className="state-message">Carregando ponto de equilíbrio...</div>;

  const temMeta = dados.custoFixoMensal > 0;
  const percentual = temMeta ? Math.min(100, Math.max(0, (dados.margemAposAds / dados.custoFixoMensal) * 100)) : 0;
  const noRitmo = temMeta && dados.projecaoFechamento >= dados.custoFixoMensal;

  return (
    <div className="financeiro-equilibrio">
      <div className="financeiro-equilibrio-header">
        <div>
          <span className="financeiro-stat-label">Ponto de equilíbrio — mês atual</span>
          <div className="financeiro-equilibrio-valores">
            <b>{formatCurrency(dados.margemAposAds)}</b>
            <span> de </span>
            <span>
              {temMeta ? `${formatCurrency(dados.custoFixoMensal)} (custo fixo somado das lojas do filtro)` : "custo fixo não configurado nessas lojas"}
            </span>
          </div>
        </div>
        <div className={`financeiro-equilibrio-status ${noRitmo ? "financeiro-margem-positiva" : "financeiro-margem-negativa"}`}>
          Projeção do mês: {formatCurrency(dados.projecaoFechamento)}
          <span className="financeiro-stat-sub">
            {dados.percentualAtingido !== null ? `${dados.percentualAtingido.toFixed(0)}% da meta · ` : ""}
            dia {dados.diasDecorridos} de {dados.diasNoMes}
          </span>
        </div>
      </div>
      <div className="financeiro-equilibrio-barra">
        <div
          className={`financeiro-equilibrio-barra-preenchida ${noRitmo ? "financeiro-equilibrio-barra-ok" : ""}`}
          style={{ width: `${percentual}%` }}
        />
      </div>
    </div>
  );
}

interface FatiaDonut {
  label: string;
  valor: number;
  cor: string;
}

function DonutFinanceiro({ fatias, total }: { fatias: FatiaDonut[]; total: number }) {
  if (total <= 0) return null;

  let acumulado = 0;
  const stops = fatias
    .filter((f) => f.valor > 0)
    .map((f) => {
      const inicio = (acumulado / total) * 360;
      acumulado += f.valor;
      const fim = (acumulado / total) * 360;
      return `${f.cor} ${inicio}deg ${fim}deg`;
    });

  return (
    <div className="financeiro-donut-card">
      <span className="financeiro-stat-label">Representação gráfica</span>
      <div className="financeiro-donut-corpo">
        <div className="financeiro-donut" style={{ background: `conic-gradient(${stops.join(", ")})` }}>
          <div className="financeiro-donut-furo" />
        </div>
        <div className="financeiro-donut-legenda">
          {fatias
            .filter((f) => f.valor > 0)
            .map((f) => (
              <div key={f.label} className="financeiro-donut-item">
                <i className="financeiro-donut-dot" style={{ background: f.cor }} />
                <span>{f.label}</span>
                <b>{((f.valor / total) * 100).toFixed(1)}%</b>
              </div>
            ))}
        </div>
      </div>
      <p className="financeiro-donut-nota">
        * O frete pago pelo comprador não entra nesse cálculo (não é custo da loja).
      </p>
    </div>
  );
}

export function Financeiro({ usuario }: Props) {
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [lojaFiltro, setLojaFiltro] = useState<number | "todas" | "minhas">("todas");
  const [dataInicio, setDataInicio] = useState(() => diasAtrasISO(7));
  const [dataFim, setDataFim] = useState(() => hojeISO());
  const [gerenciandoImpostos, setGerenciandoImpostos] = useState(false);
  const [gerenciandoCustoFixo, setGerenciandoCustoFixo] = useState(false);
  const [ordenacao, setOrdenacao] = useState<{ chave: ChaveOrdenacao; direcao: 1 | -1 }>({
    chave: "dataCriacao",
    direcao: -1,
  });
  const [filtroPedido, setFiltroPedido] = useState("");
  const [filtroTitulo, setFiltroTitulo] = useState("");
  const [filtroSku, setFiltroSku] = useState("");

  useEffect(() => {
    fetchLojas().then(setLojas).catch(() => {});
  }, []);

  const periodoValido = Boolean(dataInicio && dataFim && dataInicio <= dataFim);
  const buscarVendas = useCallback(
    (forcar: boolean) => fetchVendasFinanceiras(lojaFiltro, dataInicio, dataFim, forcar),
    [lojaFiltro, dataInicio, dataFim]
  );
  const {
    dados: resultado,
    erro,
    atualizando,
    atualizarAgora,
  } = useBuscaComCancelamento<ResultadoFinanceiro>(buscarVendas, periodoValido);

  const vendas = resultado?.vendas ?? null;
  const resumoPedidos = resultado?.resumoPedidos ?? null;
  const gastoAdsTotal = resultado?.gastoAdsTotal ?? 0;

  function ordenarPor(chave: ChaveOrdenacao) {
    setOrdenacao((atual) =>
      atual.chave === chave ? { chave, direcao: atual.direcao === 1 ? -1 : 1 } : { chave, direcao: 1 }
    );
  }

  const vendasFiltradas = useMemo(() => {
    if (!vendas) return null;
    const pedido = filtroPedido.trim();
    const titulo = filtroTitulo.trim().toLowerCase();
    const sku = filtroSku.trim().toLowerCase();
    return vendas.filter(
      (v) =>
        (!pedido || String(v.orderId).includes(pedido) || v.itemId.toLowerCase().includes(pedido.toLowerCase())) &&
        (!titulo || v.titulo.toLowerCase().includes(titulo)) &&
        (!sku || (v.sku ?? "").toLowerCase().includes(sku))
    );
  }, [vendas, filtroPedido, filtroTitulo, filtroSku]);

  const vendasOrdenadas = useMemo(() => {
    if (!vendasFiltradas) return null;
    return [...vendasFiltradas].sort((a, b) => comparar(a, b, ordenacao.chave, ordenacao.direcao));
  }, [vendasFiltradas, ordenacao]);

  const comMargem = vendasFiltradas?.filter((v) => v.margemContribuicao !== null) ?? [];
  const receitaTotal = vendasFiltradas?.reduce((s, v) => s + v.receitaTotal, 0) ?? 0;
  const custoTotalGeral = vendasFiltradas?.reduce((s, v) => s + (v.custoTotal ?? 0), 0) ?? 0;
  const taxaMlTotalGeral = vendasFiltradas?.reduce((s, v) => s + v.taxaMlTotal, 0) ?? 0;
  const freteVendedorTotalGeral = vendasFiltradas?.reduce((s, v) => s + (v.freteVendedorTotal ?? 0), 0) ?? 0;
  const freteCompradorTotalGeral = vendasFiltradas?.reduce((s, v) => s + (v.freteCompradorTotal ?? 0), 0) ?? 0;
  const impostoTotalGeral = vendasFiltradas?.reduce((s, v) => s + v.impostoTotal, 0) ?? 0;
  const margemTotal = comMargem.reduce((s, v) => s + (v.margemContribuicao ?? 0), 0);
  const margemPercentualMedia = receitaTotal > 0 ? (margemTotal / receitaTotal) * 100 : null;
  const semCustoCadastrado = (vendasFiltradas?.length ?? 0) - comMargem.length;
  const naoCalculadoDonut = Math.max(
    0,
    receitaTotal - (custoTotalGeral + impostoTotalGeral + taxaMlTotalGeral + freteVendedorTotalGeral + margemTotal)
  );

  const ticketMedioVenda = vendasFiltradas && vendasFiltradas.length > 0 ? receitaTotal / vendasFiltradas.length : null;
  const ticketMedioMargem = comMargem.length > 0 ? margemTotal / comMargem.length : null;

  // Gasto de Ads não é por venda (é por campanha, no período todo) — por isso
  // só desconta aqui, no total da janela, e não em cada linha da tabela.
  const margemAposAds = margemTotal - gastoAdsTotal;
  const margemAposAdsPercentual = receitaTotal > 0 ? (margemAposAds / receitaTotal) * 100 : null;

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
          {usuario.admin && (
            <button
              type="button"
              className="painel-estudo-gerenciar-btn"
              onClick={() => setGerenciandoImpostos((g) => !g)}
            >
              {gerenciandoImpostos ? "Fechar" : "Imposto por loja"}
            </button>
          )}
          {usuario.admin && (
            <button
              type="button"
              className="painel-estudo-gerenciar-btn"
              onClick={() => setGerenciandoCustoFixo((g) => !g)}
            >
              {gerenciandoCustoFixo ? "Fechar" : "Custo fixo por loja"}
            </button>
          )}
        </div>
      </div>

      {gerenciandoImpostos && usuario.admin && <GerenciarImpostos onFechar={() => setGerenciandoImpostos(false)} />}
      {gerenciandoCustoFixo && usuario.admin && <GerenciarCustoFixo onFechar={() => setGerenciandoCustoFixo(false)} />}

      <PontoEquilibrioCard lojaFiltro={lojaFiltro} />

      {erro && <div className="state-message state-error">{erro}</div>}
      {!erro && vendasOrdenadas === null && <div className="state-message">Carregando vendas...</div>}

      {vendasOrdenadas !== null && (
        <>
          <div className="financeiro-busca">
            <input
              className="clonar-input"
              placeholder="Nº pedido / MLB"
              value={filtroPedido}
              onChange={(e) => setFiltroPedido(e.target.value)}
            />
            <input
              className="clonar-input"
              placeholder="Buscar por título"
              value={filtroTitulo}
              onChange={(e) => setFiltroTitulo(e.target.value)}
            />
            <input
              className="clonar-input"
              placeholder="Buscar por SKU"
              value={filtroSku}
              onChange={(e) => setFiltroSku(e.target.value)}
            />
          </div>

          {vendas && vendas.length > 0 && (
            <div className="financeiro-cards-cor">
              <div className="financeiro-card-cor financeiro-card-roxo">
                <div className="financeiro-card-cor-topo">
                  <span>Vendas Aprovadas</span>
                </div>
                <div className="financeiro-card-cor-corpo">
                  <span className="financeiro-card-cor-valor">{formatCurrency(receitaTotal)}</span>
                  <span className="financeiro-card-cor-sub">Faturamento ML</span>
                </div>
              </div>
              <div className="financeiro-card-cor financeiro-card-vermelho">
                <div className="financeiro-card-cor-topo">
                  <span>Custo &amp; Imposto</span>
                </div>
                <div className="financeiro-card-cor-corpo">
                  <span className="financeiro-card-cor-valor">{formatCurrency(custoTotalGeral + impostoTotalGeral)}</span>
                  <div className="financeiro-card-cor-linha">
                    <span>Custo</span>
                    <b>{formatCurrency(custoTotalGeral)}</b>
                  </div>
                  <div className="financeiro-card-cor-linha">
                    <span>Imposto</span>
                    <b>{formatCurrency(impostoTotalGeral)}</b>
                  </div>
                </div>
              </div>
              <div className="financeiro-card-cor financeiro-card-amarelo">
                <div className="financeiro-card-cor-topo">
                  <span>Tarifa de Venda</span>
                </div>
                <div className="financeiro-card-cor-corpo">
                  <span className="financeiro-card-cor-valor">{formatCurrency(taxaMlTotalGeral)}</span>
                </div>
              </div>
              <div className="financeiro-card-cor financeiro-card-azul">
                <div className="financeiro-card-cor-topo">
                  <span>Frete Total</span>
                </div>
                <div className="financeiro-card-cor-corpo">
                  <span className="financeiro-card-cor-valor">
                    {formatCurrency(freteVendedorTotalGeral + freteCompradorTotalGeral)}
                  </span>
                  <div className="financeiro-card-cor-linha">
                    <span>Frete Comprador</span>
                    <b>{formatCurrency(freteCompradorTotalGeral)}</b>
                  </div>
                  <div className="financeiro-card-cor-linha">
                    <span>Frete Vendedor</span>
                    <b>{formatCurrency(freteVendedorTotalGeral)}</b>
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
                <span className="financeiro-stat-label">Qtd Vendas Aprovadas</span>
                <span className="financeiro-stat-valor">{resumoPedidos.pedidosAprovados}</span>
                <span className="financeiro-stat-sub">
                  Total: {resumoPedidos.totalPedidos} · Canceladas: {resumoPedidos.pedidosCancelados}
                </span>
                {semCustoCadastrado > 0 && (
                  <span className="financeiro-stat-sub">{semCustoCadastrado} sem custo cadastrado</span>
                )}
              </div>
              <div className="financeiro-stat-card">
                <span className="financeiro-stat-label">Ticket Médio por Venda Aprovada</span>
                <span className="financeiro-stat-valor">
                  {ticketMedioVenda !== null ? formatCurrency(ticketMedioVenda) : "—"}
                </span>
              </div>
              <div className="financeiro-stat-card">
                <span className="financeiro-stat-label">Ticket Médio da Margem de Contribuição</span>
                <span className={`financeiro-stat-valor ${classeMargem(margemPercentualMedia)}`}>
                  {ticketMedioMargem !== null ? formatCurrency(ticketMedioMargem) : "—"}
                </span>
                {margemPercentualMedia !== null && (
                  <span className="financeiro-stat-sub">{margemPercentualMedia.toFixed(2)}%</span>
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

          {vendas && vendas.length > 0 && (
            <DonutFinanceiro
              total={receitaTotal}
              fatias={[
                { label: "Frete Vendedor", valor: freteVendedorTotalGeral, cor: "#38bdf8" },
                { label: "Tarifa", valor: taxaMlTotalGeral, cor: "#fbbf24" },
                { label: "Margem Contrib.", valor: Math.max(0, margemTotal), cor: "#4ade80" },
                { label: "Custo", valor: custoTotalGeral, cor: "#fb923c" },
                { label: "Imposto", valor: impostoTotalGeral, cor: "#f87171" },
                { label: "Não calculado", valor: naoCalculadoDonut, cor: "#64748b" },
              ]}
            />
          )}

          {vendasOrdenadas.length === 0 && (
            <div className="state-message">Nenhuma venda encontrada com esse filtro.</div>
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
                    <tr key={`${v.orderId}-${v.sku}`}>
                      <td className="financeiro-td-titulo" title={v.titulo}>
                        {v.titulo}
                      </td>
                      <td>{v.lojaNome}</td>
                      <td className="financeiro-td-sku">{v.sku ?? "—"}</td>
                      <td>{formatDataHora(v.dataCriacao)}</td>
                      <td className="financeiro-th-numero">{formatCurrency(v.valorUnitario)}</td>
                      <td className="financeiro-th-numero">{v.quantidade}</td>
                      <td className="financeiro-th-numero">{formatCurrency(v.receitaTotal)}</td>
                      <td className="financeiro-th-numero financeiro-td-custo">
                        {v.custoTotal !== null ? formatCurrency(v.custoTotal) : "—"}
                      </td>
                      <td className="financeiro-th-numero financeiro-td-custo">{formatCurrency(v.impostoTotal)}</td>
                      <td className="financeiro-th-numero financeiro-td-custo">{formatCurrency(v.taxaMlTotal)}</td>
                      <td className="financeiro-th-numero financeiro-td-mudo">
                        {v.freteCompradorTotal !== null ? formatCurrency(v.freteCompradorTotal) : "—"}
                      </td>
                      <td className="financeiro-th-numero financeiro-td-custo">
                        {v.freteVendedorTotal !== null ? formatCurrency(v.freteVendedorTotal) : "—"}
                      </td>
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
