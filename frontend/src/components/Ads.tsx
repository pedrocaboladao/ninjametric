import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchCampanhasAds, fetchReceitaRealPorCampanha, fetchDiagnosticoOrcamento } from "../api/ads";
import { fetchLojas, type Loja } from "../api/lojas";
import type { CampanhaAds, ReceitaRealCampanha, DiagnosticoOrcamento } from "../types/ads";
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

function diasNoPeriodo(dataInicio: string, dataFim: string): number {
  const inicio = new Date(`${dataInicio}T00:00:00Z`);
  const fim = new Date(`${dataFim}T00:00:00Z`);
  return Math.max(1, Math.round((fim.getTime() - inicio.getTime()) / (24 * 60 * 60 * 1000)) + 1);
}

// TACOS real = gasto ÷ receita real do produto (todas as vendas, incluindo
// orgânicas) — calculado no front cruzando a campanha com a receita real
// buscada à parte (ver fetchReceitaRealPorCampanha), sem precisar de uma
// tabela nova: fica como mais uma coluna na campanha, ao lado do ACOS.
// acosIdeal = margem de contribuição real do produto em % — teto
// aproximado de ACOS sustentável, pra comparar com o ACOS Meta configurado
// na campanha (que pode estar solto ou apertado demais pra esse produto).
interface CampanhaComTacos extends CampanhaAds {
  tacosReal: number | null;
  acosIdeal: number | null;
  lucroReais: number | null;
}

// Lucro real = margem de contribuição real (R$, mesmo cálculo do
// Financeiro) menos o gasto de Ads — direto, sem reaplicar a margem em %
// sobre receitaBase (que pode divergir um pouco da base usada pra calcular
// a margem, já que vendasTotais do Ads e a receita cruzada com o
// Financeiro nem sempre batem exatamente). Sem margemReal (produto sem
// custo cadastrado, ou campanha sem venda cruzada) não dá pra julgar.
function calcularLucroReais(c: { custo: number; margemReal: number | null }): number | null {
  if (c.margemReal === null) return null;
  return c.margemReal - c.custo;
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

function comparar(a: CampanhaComTacos, b: CampanhaComTacos, chave: ChaveOrdenacao, direcao: 1 | -1): number {
  const va = a[chave];
  const vb = b[chave];
  if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * direcao;
  const na = va === null ? -Infinity : (va as number);
  const nb = vb === null ? -Infinity : (vb as number);
  return (na - nb) * direcao;
}

function statusLabel(status: string): string {
  if (status === "active") return "Ativa";
  if (status === "paused") return "Pausada";
  return status;
}

// Triagem: só campanhas ativas com gasto entram num grupo — pausadas ou sem
// gasto não são o foco de revisão (não estão consumindo orçamento agora).
// A ordem importa: uma campanha só cai em "orçamentoParado" se já estiver
// indo bem (tem venda, ACOS dentro da meta) mas gastando pouco perto do
// que o orçamento configurado permitiria — é oportunidade de escalar, não
// desperdício. O orçamento do Ads é diário, por isso multiplica pelos dias
// do período escolhido antes de comparar com o gasto total desse período.
const LIMIAR_ORCAMENTO_PARADO = 0.2;

type Grupo = "semVenda" | "acimaMeta" | "orcamentoParado" | "dentroMeta" | null;

function grupoDaCampanha(c: CampanhaAds, diasPeriodo: number): Grupo {
  if (c.status !== "active" || c.custo === 0) return null;
  if (c.vendasTotais === 0) return "semVenda";
  if (c.acos > c.acosMeta) return "acimaMeta";
  if (c.orcamento > 0 && c.custo / (c.orcamento * diasPeriodo) < LIMIAR_ORCAMENTO_PARADO) return "orcamentoParado";
  return "dentroMeta";
}

function classeLinha(c: CampanhaAds, diasPeriodo: number): string {
  const grupo = grupoDaCampanha(c, diasPeriodo);
  if (grupo === "semVenda") return "financeiro-margem-alerta";
  if (grupo === "acimaMeta") return "financeiro-margem-negativa";
  if (grupo === "orcamentoParado") return "financeiro-margem-positiva";
  return "";
}

function motivoDestaque(c: CampanhaAds, diasPeriodo: number): string | null {
  const grupo = grupoDaCampanha(c, diasPeriodo);
  if (grupo === "semVenda") return "Ativa com gasto, mas nenhuma venda atribuída — verba parada.";
  if (grupo === "acimaMeta") return "ROAS abaixo da meta — revisar orçamento ou pausar.";
  if (grupo === "orcamentoParado") return "Indo bem, mas usando pouco do orçamento — pode dar pra escalar.";
  return null;
}

function somarGrupo(campanhas: CampanhaAds[]) {
  return {
    qtd: campanhas.length,
    gasto: campanhas.reduce((s, c) => s + c.custo, 0),
    vendas: campanhas.reduce((s, c) => s + c.vendasTotais, 0),
  };
}

interface DadosReceitaCampanha {
  receitaTotalReal: number;
  margemReal: number;
  acosIdeal: number | null;
}

// Insights: recomendações concretas ("o que fazer"), não só sinalização de
// grupo. Reaproveita 100% dados que a tela já busca (TACOS real, ACOS
// ideal, orçamento, triagem) — nenhuma chamada nova à API do Mercado Livre
// nem ao banco, é só mais lógica em cima do que já está em memória.
type TipoInsight = "prejuizo" | "semVenda" | "margemSobra" | "orcamentoParado" | "organico";

const INSIGHT_INFO: Record<TipoInsight, { tag: string; cor: string; acao: string }> = {
  prejuizo: { tag: "Prejuízo líquido", cor: "var(--critical-text)", acao: "Cortar orçamento ou pausar agora" },
  semVenda: { tag: "Sem venda, gastando", cor: "#fbbf24", acao: "Pausar ou revisar o anúncio" },
  margemSobra: { tag: "Margem sobrando", cor: "#38bdf8", acao: "Considerar subir a meta de ACOS" },
  orcamentoParado: { tag: "Orçamento parado", cor: "var(--good-text)", acao: "Aumentar orçamento — oportunidade de escalar" },
  organico: { tag: "Pode ser orgânico", cor: "#fbbf24", acao: "Testar reduzir investimento e comparar" },
};

// TACOS bem abaixo do ACOS configurado sugere que a maior parte da venda já
// aconteceria sem o anúncio — usa metade do ACOS meta como limiar.
const LIMIAR_TACOS_ORGANICO = 0.5;
// Ignora ruído de campanhas com gasto irrisório sem venda.
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

// Uma campanha pode bater em mais de uma regra — escolhe só a mais
// relevante (prejuízo líquido é mais grave que "sem venda", que por sua vez
// é mais acionável que "pode escalar"), pra não empilhar insight repetido
// da mesma campanha.
function gerarInsight(c: CampanhaComTacos, diasPeriodo: number): Insight | null {
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
  } else if (grupo === "acimaMeta" && c.acosIdeal !== null && c.acosIdeal > c.acosMeta) {
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

// Leitura pronta do diagnóstico de esgotamento: cruza "quantos dias esgotou"
// com "rende dentro da meta?" — é essa combinação que diz a ação. Campanha
// boa esgotando cedo perde venda à tarde por falta de verba; campanha ruim
// esgotando cedo é a que fica segurando o leilão quando as boas param.
function leituraDiagnostico(d: DiagnosticoOrcamento): { texto: string; classe: string } {
  const pct = d.diasAnalisados > 0 ? d.diasEsgotados / d.diasAnalisados : 0;
  const rendeBem = d.acosPeriodo !== null && d.acosPeriodo <= d.acosMeta;
  if (pct >= 0.5 && rendeBem) {
    return {
      texto: "Esgota cedo rendendo bem — a tarde fica sem essa campanha; considerar subir o orçamento",
      classe: "financeiro-margem-positiva",
    };
  }
  if (pct >= 0.5) {
    return {
      texto: "Esgota cedo rendendo abaixo da meta — revisar antes de dar mais verba",
      classe: "financeiro-margem-negativa",
    };
  }
  if (pct >= 0.2) {
    return { texto: "Esgota em alguns dias — de olho", classe: "financeiro-margem-alerta" };
  }
  return { texto: "Roda o dia todo", classe: "financeiro-td-mudo" };
}

export function Ads() {
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
    fetchLojas().then(setLojas).catch(() => {});
  }, []);

  const buscarCampanhas = useCallback(
    (forcar: boolean) => fetchCampanhasAds(lojaFiltro, dataInicio, dataFim, forcar),
    [lojaFiltro, dataInicio, dataFim]
  );
  const {
    dados: campanhas,
    erro,
    atualizando,
    atualizarAgora,
  } = useBuscaComCancelamento<CampanhaAds[]>(buscarCampanhas, periodoValido);

  const buscarReceitaReal = useCallback(
    () => fetchReceitaRealPorCampanha(lojaFiltro, dataInicio, dataFim),
    [lojaFiltro, dataInicio, dataFim]
  );
  const { dados: receitasReais } = useBuscaComCancelamento<ReceitaRealCampanha[]>(buscarReceitaReal, periodoValido);

  // Diagnóstico de esgotamento carrega só quando o dono abre a seção — a
  // primeira análise varre 14 dias campanha por campanha na API do Mercado
  // Livre (~10-20s), não faz sentido pagar isso a cada visita à tela.
  const [diagnosticoAberto, setDiagnosticoAberto] = useState(false);
  const buscarDiagnostico = useCallback(() => fetchDiagnosticoOrcamento(lojaFiltro), [lojaFiltro]);
  const { dados: diagnostico, erro: erroDiagnostico } = useBuscaComCancelamento<DiagnosticoOrcamento[]>(
    buscarDiagnostico,
    diagnosticoAberto
  );

  const receitaRealPorCampanha = useMemo(() => {
    const mapa = new Map<string, DadosReceitaCampanha>();
    for (const r of receitasReais ?? []) {
      mapa.set(`${r.lojaId}-${r.campanhaId}`, {
        receitaTotalReal: r.receitaTotalReal,
        margemReal: r.margemReal,
        acosIdeal: r.acosIdeal,
      });
    }
    return mapa;
  }, [receitasReais]);

  function ordenarPor(chave: ChaveOrdenacao) {
    setOrdenacao((atual) =>
      atual.chave === chave ? { chave, direcao: atual.direcao === 1 ? -1 : 1 } : { chave, direcao: 1 }
    );
  }

  const diasPeriodo = useMemo(() => diasNoPeriodo(dataInicio, dataFim), [dataInicio, dataFim]);

  const campanhasComTacos = useMemo((): CampanhaComTacos[] | null => {
    if (!campanhas) return null;
    return campanhas.map((c) => {
      const dados = receitaRealPorCampanha.get(`${c.lojaId}-${c.campanhaId}`);
      const receitaReal = dados?.receitaTotalReal ?? 0;
      // TACOS não pode ficar menor que a receita já creditada ao Ads (a
      // busca de receita real é independente da de campanhas, pequena
      // diferença de fuso pode deixar uma levemente atrás da outra).
      const receitaBase = Math.max(receitaReal, c.vendasTotais);
      const tacosReal = receitaBase > 0 ? (c.custo / receitaBase) * 100 : null;
      const acosIdeal = dados?.acosIdeal ?? null;
      const margemReal = dados?.margemReal ?? null;
      return {
        ...c,
        tacosReal,
        acosIdeal,
        lucroReais: calcularLucroReais({ custo: c.custo, margemReal }),
      };
    });
  }, [campanhas, receitaRealPorCampanha]);

  const campanhasBase = useMemo(() => {
    if (!campanhasComTacos) return null;
    const nome = filtroNome.trim().toLowerCase();
    return campanhasComTacos.filter((c) => !nome || c.nome.toLowerCase().includes(nome));
  }, [campanhasComTacos, filtroNome]);

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

  // Só aparece quando um card de cor da triagem está selecionado — os
  // insights ficam restritos ao grupo escolhido, em vez de misturar tudo.
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
          <span className="painel-eyebrow">Gestão de Ads</span>
          <h1>Campanhas de publicidade</h1>
          <p className="painel-sub">
            Gasto, cliques, impressões, ROAS e TACOS real (gasto ÷ receita real do produto, incluindo venda
            orgânica) por campanha de Product Ads, em todas as lojas. ROAS abaixo da meta ou campanhas ativas sem
            gasto ficam destacadas na tabela.
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
                      <td className="financeiro-th-numero">{formatCurrency(c.vendasDiretas)}</td>
                      <td className="financeiro-th-numero">{formatCurrency(c.vendasIndiretas)}</td>
                      <td className={`financeiro-th-numero financeiro-linha-margem ${classeLinha(c, diasPeriodo)}`}>
                        {formatRoas(c.acos)} <span className="financeiro-td-mudo">({c.acos.toFixed(1)}%)</span>
                      </td>
                      <td className="financeiro-th-numero financeiro-td-mudo">
                        {formatRoas(c.acosMeta)} ({c.acosMeta.toFixed(1)}%)
                        {c.acosMetaAnterior !== null && (
                          <span
                            className="ads-meta-mudou"
                            title={`A meta era ${formatRoas(c.acosMetaAnterior)} / ACOS ${c.acosMetaAnterior.toFixed(1)}% no início do período e mudou pra ${formatRoas(c.acosMeta)} em algum momento — os números desse período misturam as duas metas.`}
                          >
                            {" "}
                            (mudou de {formatRoas(c.acosMetaAnterior)})
                          </span>
                        )}
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

          <div className="ads-insights-secao">
            <span className="ads-insights-titulo">⏱️ Quais campanhas param de rodar à tarde?</span>
            <p className="painel-sub">
              Campanha com orçamento diário esgotado some do leilão pelo resto do dia — é isso que faz o Ads
              &quot;render menos à tarde&quot;. Aqui, dia esgotado = gasto chegou a 90% do orçamento. Análise dos
              últimos 14 dias completos, contra o orçamento configurado hoje.
            </p>
            {!diagnosticoAberto && (
              <button
                type="button"
                className="btn-responder financeiro-btn-hoje"
                onClick={() => setDiagnosticoAberto(true)}
              >
                Analisar campanhas
              </button>
            )}
            {diagnosticoAberto && erroDiagnostico && <div className="state-message state-error">{erroDiagnostico}</div>}
            {diagnosticoAberto && !erroDiagnostico && diagnostico === null && (
              <div className="state-message">
                Analisando 14 dias de gasto, campanha por campanha — a primeira vez pode levar uns 20 segundos...
              </div>
            )}
            {diagnosticoAberto && diagnostico !== null && (
              <div className="financeiro-tabela-wrap">
                <table className="financeiro-tabela">
                  <thead>
                    <tr>
                      <th>Conta</th>
                      <th>Campanha</th>
                      <th className="financeiro-th-numero">Orçamento/dia</th>
                      <th className="financeiro-th-numero" title="Dias em que o gasto chegou a 90% do orçamento diário — a campanha quase certamente parou antes da meia-noite nesses dias.">
                        Dias que esgotou
                      </th>
                      <th className="financeiro-th-numero" title="Média de quanto do orçamento diário foi usado nos dias com gasto.">
                        Uso médio do orçamento
                      </th>
                      <th className="financeiro-th-numero">ROAS 14d</th>
                      <th>Leitura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diagnostico.length === 0 && (
                      <tr>
                        <td colSpan={7} className="financeiro-td-mudo">
                          Nenhuma campanha ativa com dados suficientes (mínimo 3 dias com gasto nos últimos 14).
                        </td>
                      </tr>
                    )}
                    {diagnostico.map((d) => {
                      const leitura = leituraDiagnostico(d);
                      return (
                        <tr key={`${d.lojaId}-${d.campanhaId}`}>
                          <td>{d.lojaNome}</td>
                          <td className="financeiro-td-titulo">{d.nome}</td>
                          <td className="financeiro-th-numero">{formatCurrency(d.orcamento)}</td>
                          <td className="financeiro-th-numero">
                            <b>{d.diasEsgotados}</b> de {d.diasAnalisados}
                          </td>
                          <td className="financeiro-th-numero">{d.utilizacaoMedia.toFixed(0)}%</td>
                          <td className="financeiro-th-numero">
                            {d.acosPeriodo !== null ? (
                              <>
                                {formatRoas(d.acosPeriodo)}{" "}
                                <span className="financeiro-td-mudo">({d.acosPeriodo.toFixed(1)}%)</span>
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className={leitura.classe}>{leitura.texto}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
