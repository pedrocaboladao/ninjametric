import { useEffect, useMemo, useState } from "react";
import { fetchCampanhasAds } from "../api/ads";
import { fetchLojas, type Loja } from "../api/lojas";
import type { CampanhaAds } from "../types/ads";
import { formatCurrency } from "../utils/format";

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
  | "acosMeta";

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
  { chave: "acos", label: "ACOS", numerica: true },
  { chave: "acosMeta", label: "ACOS Meta", numerica: true },
];

function comparar(a: CampanhaAds, b: CampanhaAds, chave: ChaveOrdenacao, direcao: 1 | -1): number {
  const va = a[chave];
  const vb = b[chave];
  if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * direcao;
  return ((va as number) - (vb as number)) * direcao;
}

function statusLabel(status: string): string {
  if (status === "active") return "Ativa";
  if (status === "paused") return "Pausada";
  return status;
}

// Triagem: só campanhas ativas com gasto entram num grupo — pausadas ou sem
// gasto não são o foco de revisão (não estão consumindo orçamento agora).
type Grupo = "semVenda" | "acimaMeta" | "dentroMeta" | null;

function grupoDaCampanha(c: CampanhaAds): Grupo {
  if (c.status !== "active" || c.custo === 0) return null;
  if (c.vendasTotais === 0) return "semVenda";
  if (c.acos > c.acosMeta) return "acimaMeta";
  return "dentroMeta";
}

function classeLinha(c: CampanhaAds): string {
  const grupo = grupoDaCampanha(c);
  if (grupo === "semVenda") return "financeiro-margem-alerta";
  if (grupo === "acimaMeta") return "financeiro-margem-negativa";
  return "";
}

function motivoDestaque(c: CampanhaAds): string | null {
  const grupo = grupoDaCampanha(c);
  if (grupo === "semVenda") return "Ativa com gasto, mas nenhuma venda atribuída — verba parada.";
  if (grupo === "acimaMeta") return "ACOS acima da meta — revisar orçamento ou pausar.";
  return null;
}

function somarGrupo(campanhas: CampanhaAds[]) {
  return {
    qtd: campanhas.length,
    gasto: campanhas.reduce((s, c) => s + c.custo, 0),
    vendas: campanhas.reduce((s, c) => s + c.vendasTotais, 0),
  };
}

export function Ads() {
  const [campanhas, setCampanhas] = useState<CampanhaAds[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [lojaFiltro, setLojaFiltro] = useState<number | "todas" | "minhas">("todas");
  const [dataInicio, setDataInicio] = useState(() => diasAtrasISO(7));
  const [dataFim, setDataFim] = useState(() => hojeISO());
  const [ordenacao, setOrdenacao] = useState<{ chave: ChaveOrdenacao; direcao: 1 | -1 }>({
    chave: "custo",
    direcao: -1,
  });
  const [filtroNome, setFiltroNome] = useState("");
  const [atualizando, setAtualizando] = useState(false);
  const [grupoFiltro, setGrupoFiltro] = useState<Grupo | "todos">("todos");

  useEffect(() => {
    fetchLojas().then(setLojas).catch(() => {});
  }, []);

  useEffect(() => {
    if (!dataInicio || !dataFim || dataInicio > dataFim) return;
    setCampanhas(null);
    setErro(null);
    fetchCampanhasAds(lojaFiltro, dataInicio, dataFim)
      .then(setCampanhas)
      .catch((err) => setErro(err instanceof Error ? err.message : "Falha ao carregar campanhas."));
  }, [lojaFiltro, dataInicio, dataFim]);

  function atualizarAgora() {
    if (!dataInicio || !dataFim || dataInicio > dataFim) return;
    setAtualizando(true);
    setErro(null);
    fetchCampanhasAds(lojaFiltro, dataInicio, dataFim, true)
      .then(setCampanhas)
      .catch((err) => setErro(err instanceof Error ? err.message : "Falha ao carregar campanhas."))
      .finally(() => setAtualizando(false));
  }

  function ordenarPor(chave: ChaveOrdenacao) {
    setOrdenacao((atual) =>
      atual.chave === chave ? { chave, direcao: atual.direcao === 1 ? -1 : 1 } : { chave, direcao: 1 }
    );
  }

  const campanhasBase = useMemo(() => {
    if (!campanhas) return null;
    const nome = filtroNome.trim().toLowerCase();
    return campanhas.filter((c) => !nome || c.nome.toLowerCase().includes(nome));
  }, [campanhas, filtroNome]);

  const buckets = useMemo(() => {
    const base = campanhasBase ?? [];
    return {
      semVenda: somarGrupo(base.filter((c) => grupoDaCampanha(c) === "semVenda")),
      acimaMeta: somarGrupo(base.filter((c) => grupoDaCampanha(c) === "acimaMeta")),
      dentroMeta: somarGrupo(base.filter((c) => grupoDaCampanha(c) === "dentroMeta")),
    };
  }, [campanhasBase]);

  const campanhasFiltradas = useMemo(() => {
    if (!campanhasBase) return null;
    if (grupoFiltro === "todos") return campanhasBase;
    return campanhasBase.filter((c) => grupoDaCampanha(c) === grupoFiltro);
  }, [campanhasBase, grupoFiltro]);

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

  function alternarGrupo(grupo: Grupo) {
    setGrupoFiltro((atual) => (atual === grupo ? "todos" : grupo));
  }

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <span className="painel-eyebrow">Gestão de Ads</span>
          <h1>Campanhas de publicidade</h1>
          <p className="painel-sub">
            Gasto, cliques, impressões e ACOS por campanha de Product Ads, em todas as lojas. ACOS acima da meta ou
            campanhas ativas sem gasto ficam destacadas na tabela.
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
        </div>
      </div>

      {erro && <div className="state-message state-error">{erro}</div>}
      {!erro && campanhasOrdenadas === null && <div className="state-message">Carregando campanhas...</div>}

      {campanhasOrdenadas !== null && (
        <>
          <div className="financeiro-stats">
            <div className="financeiro-stat-card financeiro-stat-card-destaque">
              <span className="financeiro-stat-label">Gasto total</span>
              <span className="financeiro-stat-valor financeiro-stat-valor-grande">{formatCurrency(custoTotal)}</span>
            </div>
            <div className="financeiro-stat-card">
              <span className="financeiro-stat-label">Vendas atribuídas</span>
              <span className="financeiro-stat-valor">{formatCurrency(vendasTotais)}</span>
              <span className="financeiro-stat-sub">Diretas + indiretas</span>
            </div>
            <div className="financeiro-stat-card">
              <span className="financeiro-stat-label">ACOS médio</span>
              <span className="financeiro-stat-valor">{acosMedio !== null ? `${acosMedio.toFixed(1)}%` : "—"}</span>
              <span className="financeiro-stat-sub">Gasto ÷ vendas atribuídas</span>
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
              <span className="financeiro-stat-sub">ACOS acima da meta ou sem gasto</span>
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
              <span className="financeiro-stat-label">ACOS acima da meta</span>
              <span className="financeiro-stat-valor">{buckets.acimaMeta.qtd} campanhas</span>
              <span className="financeiro-stat-sub">
                Gasto: {formatCurrency(buckets.acimaMeta.gasto)} · Vendas: {formatCurrency(buckets.acimaMeta.vendas)}
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
                </tr>
              </thead>
              <tbody>
                {campanhasOrdenadas.length === 0 && (
                  <tr>
                    <td colSpan={COLUNAS.length} className="financeiro-td-mudo">
                      Nenhuma campanha encontrada nesse período.
                    </td>
                  </tr>
                )}
                {campanhasOrdenadas.map((c) => {
                  const motivo = motivoDestaque(c);
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
                      <td className="financeiro-th-numero">{formatCurrency(c.vendasDiretas)}</td>
                      <td className="financeiro-th-numero">{formatCurrency(c.vendasIndiretas)}</td>
                      <td className={`financeiro-th-numero financeiro-linha-margem ${classeLinha(c)}`}>
                        {c.acos.toFixed(1)}%
                      </td>
                      <td className="financeiro-th-numero financeiro-td-mudo">{c.acosMeta.toFixed(1)}%</td>
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
