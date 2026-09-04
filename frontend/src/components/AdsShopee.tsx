import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchCampanhasAdsShopee } from "../api/adsShopee";
import { fetchLojasShopee, type Loja } from "../api/lojas";
import type { CampanhaAdsShopee } from "../types/adsShopee";
import { formatCurrency, formatRoas } from "../utils/format";
import { useBuscaComCancelamento } from "../hooks/useBuscaComCancelamento";

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
  | "lojaNome"
  | "nome"
  | "status"
  | "orcamento"
  | "custo"
  | "cliques"
  | "impressoes"
  | "cpc"
  | "vendasDiretas"
  | "vendasIndiretas"
  | "acos"
  | "acosMeta"
  | "tacosReal"
  | "acosIdeal";

interface Coluna {
  chave: ChaveOrdenacao;
  label: string;
  numerica?: boolean;
}

const COLUNAS: Coluna[] = [
  { chave: "lojaNome", label: "Conta" },
  { chave: "nome", label: "Campanha" },
  { chave: "status", label: "Status" },
  { chave: "orcamento", label: "Orçamento", numerica: true },
  { chave: "custo", label: "Gasto", numerica: true },
  { chave: "cliques", label: "Cliques", numerica: true },
  { chave: "impressoes", label: "Impressões", numerica: true },
  { chave: "cpc", label: "CPC", numerica: true },
  { chave: "vendasDiretas", label: "Vendas Diretas", numerica: true },
  { chave: "vendasIndiretas", label: "Vendas Indiretas", numerica: true },
  { chave: "acos", label: "ROAS (ACOS)", numerica: true },
  { chave: "acosMeta", label: "ROAS Meta (ACOS)", numerica: true },
  { chave: "tacosReal", label: "TACOS Real", numerica: true },
  { chave: "acosIdeal", label: "ROAS Mínimo (ACOS)", numerica: true },
];

function comparar(a: CampanhaAdsShopee, b: CampanhaAdsShopee, chave: ChaveOrdenacao, direcao: 1 | -1): number {
  const va = a[chave];
  const vb = b[chave];
  if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * direcao;
  const na = va === null ? -Infinity : (va as number);
  const nb = vb === null ? -Infinity : (vb as number);
  return (na - nb) * direcao;
}

// Status real vindo da Shopee — "ongoing"/"paused"/"ended"/etc (achado ao
// vivo: uma campanha antiga aparece "ended", não some da lista).
function statusLabel(status: string): string {
  if (status === "ongoing") return "Ativa";
  if (status === "paused") return "Pausada";
  if (status === "ended") return "Encerrada";
  return status;
}

const LIMIAR_ORCAMENTO_PARADO = 0.2;

type Grupo = "semVenda" | "acimaMeta" | "orcamentoParado" | "dentroMeta" | null;

// Igual ao Gestão de Ads do Mercado Livre, só que acosMeta pode ser null
// aqui (campanha de lance manual não tem meta) — nesse caso nunca cai em
// "acimaMeta" por falta de meta pra comparar.
function grupoDaCampanha(c: CampanhaAdsShopee, diasPeriodo: number): Grupo {
  if (c.status !== "ongoing" || c.custo === 0) return null;
  if (c.vendasTotais === 0) return "semVenda";
  if (c.acosMeta !== null && c.acos > c.acosMeta) return "acimaMeta";
  if (c.orcamento > 0 && c.custo / (c.orcamento * diasPeriodo) < LIMIAR_ORCAMENTO_PARADO) return "orcamentoParado";
  return "dentroMeta";
}

function classeLinha(c: CampanhaAdsShopee, diasPeriodo: number): string {
  const grupo = grupoDaCampanha(c, diasPeriodo);
  if (grupo === "semVenda") return "financeiro-margem-alerta";
  if (grupo === "acimaMeta") return "financeiro-margem-negativa";
  if (grupo === "orcamentoParado") return "financeiro-margem-positiva";
  return "";
}

function motivoDestaque(c: CampanhaAdsShopee, diasPeriodo: number): string | null {
  const grupo = grupoDaCampanha(c, diasPeriodo);
  if (grupo === "semVenda") return "Ativa com gasto, mas nenhuma venda atribuída — verba parada.";
  if (grupo === "acimaMeta") return "ROAS abaixo da meta — revisar orçamento ou pausar.";
  if (grupo === "orcamentoParado") return "Indo bem, mas usando pouco do orçamento — pode dar pra escalar.";
  return null;
}

function somarGrupo(campanhas: CampanhaAdsShopee[]) {
  return {
    qtd: campanhas.length,
    gasto: campanhas.reduce((s, c) => s + c.custo, 0),
    vendas: campanhas.reduce((s, c) => s + c.vendasTotais, 0),
  };
}

type TipoInsight = "prejuizo" | "semVenda" | "margemSobra" | "orcamentoParado" | "organico";

const INSIGHT_INFO: Record<TipoInsight, { tag: string; cor: string; acao: string }> = {
  prejuizo: { tag: "Prejuízo líquido", cor: "var(--critical-text)", acao: "Cortar orçamento ou pausar agora" },
  semVenda: { tag: "Sem venda, gastando", cor: "#fbbf24", acao: "Pausar ou revisar o anúncio" },
  margemSobra: { tag: "Margem sobrando", cor: "#38bdf8", acao: "Considerar subir a meta de ROAS" },
  orcamentoParado: { tag: "Orçamento parado", cor: "var(--good-text)", acao: "Aumentar orçamento — oportunidade de escalar" },
  organico: { tag: "Pode ser orgânico", cor: "#fbbf24", acao: "Testar reduzir investimento e comparar" },
};

const LIMIAR_TACOS_ORGANICO = 0.5;
const GASTO_MINIMO_SEM_VENDA = 20;

interface Insight {
  chave: string;
  tipo: TipoInsight;
  tag: string;
  cor: string;
  produto: string;
  loja: string;
  contexto: ReactNode;
  acao: string;
}

function gerarInsight(c: CampanhaAdsShopee, diasPeriodo: number): Insight | null {
  const grupo = grupoDaCampanha(c, diasPeriodo);
  let tipo: TipoInsight | null = null;
  let contexto: ReactNode = null;

  if (c.acosIdeal !== null && c.vendasTotais > 0 && c.acos > c.acosIdeal) {
    tipo = "prejuizo";
    contexto = (
      <>
        ROAS de <b>{formatRoas(c.acos)}</b> (ACOS {c.acos.toFixed(0)}%), abaixo até do mínimo que a margem real
        aguenta (<b>{formatRoas(c.acosIdeal)}</b>, ACOS {c.acosIdeal.toFixed(0)}%) — cada venda está dando prejuízo.
      </>
    );
  } else if (grupo === "semVenda" && c.custo >= GASTO_MINIMO_SEM_VENDA) {
    tipo = "semVenda";
    contexto = (
      <>
        Gastou <b>{formatCurrency(c.custo)}</b> em <b>{diasPeriodo} dia{diasPeriodo > 1 ? "s" : ""}</b> sem nenhuma
        venda atribuída.
      </>
    );
  } else if (grupo === "acimaMeta" && c.acosIdeal !== null && c.acosMeta !== null && c.acosIdeal > c.acosMeta) {
    tipo = "margemSobra";
    contexto = (
      <>
        ROAS de <b>{formatRoas(c.acos)}</b> (ACOS {c.acos.toFixed(0)}%) vs meta de{" "}
        <b>{formatRoas(c.acosMeta)}</b> (ACOS {c.acosMeta.toFixed(0)}%) — mas a margem real aguentaria descer até{" "}
        <b>{formatRoas(c.acosIdeal)}</b> (ACOS {c.acosIdeal.toFixed(0)}%).
      </>
    );
  } else if (grupo === "orcamentoParado") {
    const pctOrcamento = c.orcamento > 0 ? (c.custo / (c.orcamento * diasPeriodo)) * 100 : 0;
    tipo = "orcamentoParado";
    contexto = (
      <>
        Gastando só <b>{pctOrcamento.toFixed(0)}%</b> do orçamento diário, com ROAS saudável de{" "}
        <b>{formatRoas(c.acos)}</b> (ACOS {c.acos.toFixed(0)}%).
      </>
    );
  } else if (
    c.tacosReal !== null &&
    c.acosMeta !== null &&
    c.acosMeta > 0 &&
    c.vendasTotais > 0 &&
    c.tacosReal < c.acosMeta * LIMIAR_TACOS_ORGANICO
  ) {
    tipo = "organico";
    contexto = (
      <>
        TACOS real de <b>{c.tacosReal.toFixed(0)}%</b> vs meta configurada de <b>{formatRoas(c.acosMeta)}</b> (ACOS{" "}
        {c.acosMeta.toFixed(0)}%) — a maior parte da venda parece já vir sem o anúncio.
      </>
    );
  }

  if (tipo === null) return null;
  const info = INSIGHT_INFO[tipo];
  return {
    chave: `${c.lojaId}-${c.campanhaId}`,
    tipo,
    tag: info.tag,
    cor: info.cor,
    produto: c.nome,
    loja: c.lojaNome,
    contexto,
    acao: info.acao,
  };
}

const PRIORIDADE_INSIGHT: Record<TipoInsight, number> = {
  prejuizo: 0,
  semVenda: 1,
  margemSobra: 2,
  orcamentoParado: 3,
  organico: 4,
};

export function AdsShopee() {
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [lojaFiltro, setLojaFiltro] = useState<number | "todas" | "minhas">("todas");
  const [dataInicio, setDataInicio] = useState(() => hojeISO());
  const [dataFim, setDataFim] = useState(() => hojeISO());
  const [ordenacao, setOrdenacao] = useState<{ chave: ChaveOrdenacao; direcao: 1 | -1 }>({
    chave: "custo",
    direcao: -1,
  });
  const [filtroNome, setFiltroNome] = useState("");
  const [grupoFiltro, setGrupoFiltro] = useState<Grupo | "todos">("todos");

  const periodoValido = Boolean(dataInicio && dataFim && dataInicio <= dataFim);

  useEffect(() => {
    fetchLojasShopee().then(setLojas).catch(() => {});
  }, []);

  const buscarCampanhas = useCallback(
    (forcar: boolean) => fetchCampanhasAdsShopee(lojaFiltro, dataInicio, dataFim, forcar),
    [lojaFiltro, dataInicio, dataFim]
  );
  const {
    dados: campanhas,
    erro,
    atualizando,
    atualizarAgora,
  } = useBuscaComCancelamento<CampanhaAdsShopee[]>(buscarCampanhas, periodoValido);

  function ordenarPor(chave: ChaveOrdenacao) {
    setOrdenacao((atual) =>
      atual.chave === chave ? { chave, direcao: atual.direcao === 1 ? -1 : 1 } : { chave, direcao: 1 }
    );
  }

  const diasPeriodo = useMemo(() => {
    const inicio = new Date(`${dataInicio}T00:00:00Z`);
    const fim = new Date(`${dataFim}T00:00:00Z`);
    return Math.max(1, Math.round((fim.getTime() - inicio.getTime()) / (24 * 60 * 60 * 1000)) + 1);
  }, [dataInicio, dataFim]);

  const campanhasBase = useMemo(() => {
    if (!campanhas) return null;
    const nome = filtroNome.trim().toLowerCase();
    return campanhas.filter((c) => !nome || c.nome.toLowerCase().includes(nome));
  }, [campanhas, filtroNome]);

  const buckets = useMemo(() => {
    const base = campanhasBase ?? [];
    return {
      semVenda: somarGrupo(base.filter((c) => grupoDaCampanha(c, diasPeriodo) === "semVenda")),
      acimaMeta: somarGrupo(base.filter((c) => grupoDaCampanha(c, diasPeriodo) === "acimaMeta")),
      orcamentoParado: somarGrupo(base.filter((c) => grupoDaCampanha(c, diasPeriodo) === "orcamentoParado")),
      dentroMeta: somarGrupo(base.filter((c) => grupoDaCampanha(c, diasPeriodo) === "dentroMeta")),
    };
  }, [campanhasBase, diasPeriodo]);

  const campanhasFiltradas = useMemo(() => {
    if (!campanhasBase) return null;
    if (grupoFiltro === "todos") return campanhasBase;
    return campanhasBase.filter((c) => grupoDaCampanha(c, diasPeriodo) === grupoFiltro);
  }, [campanhasBase, grupoFiltro, diasPeriodo]);

  const insights = useMemo(() => {
    if (grupoFiltro === "todos") return [];
    const base = campanhasFiltradas ?? [];
    return base
      .map((c) => gerarInsight(c, diasPeriodo))
      .filter((i): i is Insight => i !== null)
      .sort((a, b) => PRIORIDADE_INSIGHT[a.tipo] - PRIORIDADE_INSIGHT[b.tipo]);
  }, [campanhasFiltradas, grupoFiltro, diasPeriodo]);

  const campanhasOrdenadas = useMemo(() => {
    if (!campanhasFiltradas) return null;
    return [...campanhasFiltradas].sort((a, b) => comparar(a, b, ordenacao.chave, ordenacao.direcao));
  }, [campanhasFiltradas, ordenacao]);

  const custoTotal = campanhasFiltradas?.reduce((s, c) => s + c.custo, 0) ?? 0;
  const vendasTotais = campanhasFiltradas?.reduce((s, c) => s + c.vendasTotais, 0) ?? 0;
  const cliquesTotais = campanhasFiltradas?.reduce((s, c) => s + c.cliques, 0) ?? 0;
  const impressoesTotais = campanhasFiltradas?.reduce((s, c) => s + c.impressoes, 0) ?? 0;
  const acosMedio = vendasTotais > 0 ? (custoTotal / vendasTotais) * 100 : null;
  const campanhasComProblema = buckets.semVenda.qtd + buckets.acimaMeta.qtd;
  const lucroTotal = campanhasFiltradas?.reduce((s, c) => s + (c.lucroReais ?? 0), 0) ?? 0;
  const campanhasSemMargem = campanhasFiltradas?.filter((c) => c.lucroReais === null).length ?? 0;

  function alternarGrupo(grupo: Grupo) {
    setGrupoFiltro((atual) => (atual === grupo ? "todos" : grupo));
  }

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <span className="painel-eyebrow">Gestão de Ads (Shopee)</span>
          <h1>Campanhas de publicidade</h1>
          <p className="painel-sub">
            Gasto, cliques, impressões, ROAS e TACOS real (gasto ÷ receita real do produto, incluindo venda
            orgânica) por campanha de Ads da Shopee. ROAS abaixo da meta ou campanhas ativas sem gasto ficam
            destacadas na tabela.
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
      {!erro && campanhasOrdenadas === null && <div className="state-message">Carregando campanhas...</div>}

      {campanhasOrdenadas !== null && (
        <>
          <div className="financeiro-stats">
            <div className="financeiro-stat-card financeiro-stat-card-destaque">
              <span className="financeiro-stat-label">Lucro</span>
              <span
                className={`financeiro-stat-valor financeiro-stat-valor-grande ${
                  lucroTotal >= 0 ? "financeiro-margem-positiva" : "financeiro-margem-negativa"
                }`}
              >
                {formatCurrency(lucroTotal)}
              </span>
              <span className="financeiro-stat-sub">
                {campanhasSemMargem > 0
                  ? `TACOS vs ROAS Ideal — ${campanhasSemMargem} campanha${campanhasSemMargem > 1 ? "s" : ""} sem dado de margem`
                  : "TACOS real vs ROAS Ideal (margem)"}
              </span>
            </div>
            <div className="financeiro-stat-card">
              <span className="financeiro-stat-label">Gasto total</span>
              <span className="financeiro-stat-valor">{formatCurrency(custoTotal)}</span>
            </div>
            <div className="financeiro-stat-card">
              <span className="financeiro-stat-label">Vendas atribuídas</span>
              <span className="financeiro-stat-valor">{formatCurrency(vendasTotais)}</span>
              <span className="financeiro-stat-sub">Diretas + indiretas</span>
            </div>
            <div className="financeiro-stat-card">
              <span className="financeiro-stat-label">ROAS médio</span>
              <span className="financeiro-stat-valor">
                {acosMedio !== null ? `${formatRoas(acosMedio)} (${acosMedio.toFixed(1)}% ACOS)` : "—"}
              </span>
              <span className="financeiro-stat-sub">Vendas atribuídas ÷ gasto</span>
            </div>
            <div className="financeiro-stat-card">
              <span className="financeiro-stat-label">Cliques / Impressões</span>
              <span className="financeiro-stat-valor">
                {cliquesTotais.toLocaleString("pt-BR")} / {impressoesTotais.toLocaleString("pt-BR")}
              </span>
            </div>
            <div className="financeiro-stat-card">
              <span className="financeiro-stat-label">Campanhas p/ revisar</span>
              <span className="financeiro-stat-valor financeiro-margem-negativa">{campanhasComProblema}</span>
              <span className="financeiro-stat-sub">ROAS abaixo da meta ou sem gasto</span>
            </div>
          </div>

          <div className="ads-triagem">
            <button
              type="button"
              className={`ads-triagem-card ads-triagem-amarelo ${grupoFiltro === "semVenda" ? "ads-triagem-selecionado" : ""}`}
              onClick={() => alternarGrupo("semVenda")}
            >
              <span className="financeiro-stat-label">Sem venda atribuída</span>
              <span className="financeiro-stat-valor">{buckets.semVenda.qtd} campanhas</span>
              <span className="financeiro-stat-sub">Gasto: {formatCurrency(buckets.semVenda.gasto)} — 100% desperdício</span>
            </button>
            <button
              type="button"
              className={`ads-triagem-card ads-triagem-vermelho ${grupoFiltro === "acimaMeta" ? "ads-triagem-selecionado" : ""}`}
              onClick={() => alternarGrupo("acimaMeta")}
            >
              <span className="financeiro-stat-label">ROAS abaixo da meta</span>
              <span className="financeiro-stat-valor">{buckets.acimaMeta.qtd} campanhas</span>
              <span className="financeiro-stat-sub">
                Gasto: {formatCurrency(buckets.acimaMeta.gasto)} · Vendas: {formatCurrency(buckets.acimaMeta.vendas)}
              </span>
            </button>
            <button
              type="button"
              className={`ads-triagem-card ads-triagem-azul ${grupoFiltro === "orcamentoParado" ? "ads-triagem-selecionado" : ""}`}
              onClick={() => alternarGrupo("orcamentoParado")}
              title="Indo bem (tem venda, ROAS dentro da meta), mas gastando menos de 20% do orçamento configurado — pode dar pra investir mais."
            >
              <span className="financeiro-stat-label">Orçamento parado</span>
              <span className="financeiro-stat-valor">{buckets.orcamentoParado.qtd} campanhas</span>
              <span className="financeiro-stat-sub">
                Gasto: {formatCurrency(buckets.orcamentoParado.gasto)} · Vendas: {formatCurrency(buckets.orcamentoParado.vendas)}
              </span>
            </button>
            <button
              type="button"
              className={`ads-triagem-card ads-triagem-verde ${grupoFiltro === "dentroMeta" ? "ads-triagem-selecionado" : ""}`}
              onClick={() => alternarGrupo("dentroMeta")}
            >
              <span className="financeiro-stat-label">Dentro da meta</span>
              <span className="financeiro-stat-valor">{buckets.dentroMeta.qtd} campanhas</span>
              <span className="financeiro-stat-sub">
                Gasto: {formatCurrency(buckets.dentroMeta.gasto)} · Vendas: {formatCurrency(buckets.dentroMeta.vendas)}
              </span>
            </button>
          </div>

          {insights.length > 0 && (
            <div className="ads-insights-secao">
              <span className="ads-insights-titulo">💡 Insights</span>
              <div className="ads-insights-grid">
                {insights.map((i) => (
                  <div key={i.chave} className="ads-insight-card" style={{ borderLeftColor: i.cor }}>
                    <span className="ads-insight-tag" style={{ color: i.cor }}>
                      {i.tag}
                    </span>
                    <span className="ads-insight-produto" title={i.produto}>
                      {i.produto}
                    </span>
                    <span className="ads-insight-loja">{i.loja}</span>
                    <p className="ads-insight-contexto">{i.contexto}</p>
                    <div className="ads-insight-acao" style={{ color: i.cor }}>
                      → {i.acao}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <input
            type="text"
            className="dashboard-select"
            placeholder="Buscar por nome da campanha..."
            value={filtroNome}
            onChange={(e) => setFiltroNome(e.target.value)}
          />

          <div className="financeiro-tabela-wrap">
            <table className="financeiro-tabela">
              <thead>
                <tr>
                  {COLUNAS.map((col) => (
                    <th
                      key={col.chave}
                      className={col.numerica ? "financeiro-th-numero" : undefined}
                      onClick={() => ordenarPor(col.chave)}
                    >
                      {col.label} {ordenacao.chave === col.chave ? (ordenacao.direcao === 1 ? "▲" : "▼") : ""}
                    </th>
                  ))}
                  <th
                    className="financeiro-th-numero"
                    title="Receita do produto × ROAS Ideal (margem) menos o gasto de Ads — lucro real da campanha, já considerando a margem do produto."
                  >
                    Lucro
                  </th>
                </tr>
              </thead>
              <tbody>
                {campanhasOrdenadas.length === 0 && (
                  <tr>
                    <td colSpan={COLUNAS.length + 1} className="financeiro-td-mudo">
                      Nenhuma campanha encontrada nesse período.
                    </td>
                  </tr>
                )}
                {campanhasOrdenadas.map((c) => {
                  const motivo = motivoDestaque(c, diasPeriodo);
                  return (
                    <tr key={`${c.lojaId}-${c.campanhaId}`} title={motivo ?? undefined}>
                      <td>{c.lojaNome}</td>
                      <td className="financeiro-td-titulo">{c.nome}</td>
                      <td>{statusLabel(c.status)}</td>
                      <td className="financeiro-th-numero">{formatCurrency(c.orcamento)}</td>
                      <td className="financeiro-th-numero">{formatCurrency(c.custo)}</td>
                      <td className="financeiro-th-numero">{c.cliques.toLocaleString("pt-BR")}</td>
                      <td className="financeiro-th-numero">{c.impressoes.toLocaleString("pt-BR")}</td>
                      <td className="financeiro-th-numero">{formatCurrency(c.cpc)}</td>
                      <td className="financeiro-th-numero">{c.vendasDiretas.toLocaleString("pt-BR")}</td>
                      <td className="financeiro-th-numero">{c.vendasIndiretas.toLocaleString("pt-BR")}</td>
                      <td className={`financeiro-th-numero financeiro-linha-margem ${classeLinha(c, diasPeriodo)}`}>
                        {formatRoas(c.acos)} <span className="financeiro-td-mudo">({c.acos.toFixed(1)}%)</span>
                      </td>
                      <td className="financeiro-th-numero financeiro-td-mudo">
                        {c.acosMeta !== null ? `${formatRoas(c.acosMeta)} (${c.acosMeta.toFixed(1)}%)` : "—"}
                      </td>
                      <td className="financeiro-th-numero">{c.tacosReal !== null ? `${c.tacosReal.toFixed(1)}%` : "—"}</td>
                      <td className="financeiro-th-numero financeiro-td-mudo">
                        {c.acosIdeal !== null ? `${formatRoas(c.acosIdeal)} (${c.acosIdeal.toFixed(1)}%)` : "—"}
                      </td>
                      <td
                        className={`financeiro-th-numero ${
                          c.lucroReais === null
                            ? "financeiro-margem-neutra"
                            : c.lucroReais >= 0
                              ? "financeiro-margem-positiva"
                              : "financeiro-margem-negativa"
                        }`}
                      >
                        {c.lucroReais !== null ? formatCurrency(c.lucroReais) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
