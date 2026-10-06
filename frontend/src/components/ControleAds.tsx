import { useEffect, useRef, useState } from "react";
import type {
  CampanhaControleAds,
  ContaControleAds,
  DiaControleAds,
  MetaControleAds,
  NivelControleAds,
  PainelControleAds,
} from "../types/controleAds";
import { fetchPainelControleAds, salvarMetaControleAds } from "../api/controleAds";
import { formatCurrency } from "../utils/format";
import "./ControleAds.css";

// A barra de margem vai de -20% (prejuízo forte) a +40%.
const MARGEM_MINIMA_ESCALA = -20;
const MARGEM_MAXIMA_ESCALA = 40;

const ROTULOS: Record<NivelControleAds, string> = {
  motor: "MOTOR",
  atencao: "ATENÇÃO",
  sangria: "SANGRIA",
  sem_dados: "SEM DADOS",
};

function posicaoNaEscala(margem: number): number {
  const pct = ((margem - MARGEM_MINIMA_ESCALA) / (MARGEM_MAXIMA_ESCALA - MARGEM_MINIMA_ESCALA)) * 100;
  return Math.min(Math.max(pct, 0), 100);
}

function formatarData(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function diasAtras(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return formatarData(d);
}

type Periodo = "hoje" | "semana" | "quinzena" | "mes" | "livre";
type PeriodoPredefinido = Exclude<Periodo, "livre">;

function intervaloDoPeriodo(periodo: PeriodoPredefinido): { inicio: string; fim: string } {
  const hoje = formatarData(new Date());
  if (periodo === "hoje") return { inicio: hoje, fim: hoje };
  if (periodo === "semana") return { inicio: diasAtras(6), fim: hoje };
  if (periodo === "quinzena") return { inicio: diasAtras(14), fim: hoje };
  const d = new Date();
  return { inicio: formatarData(new Date(d.getFullYear(), d.getMonth(), 1)), fim: hoje };
}

const PERIODOS: { id: PeriodoPredefinido; rotulo: string }[] = [
  { id: "hoje", rotulo: "Hoje" },
  { id: "semana", rotulo: "7 dias" },
  { id: "quinzena", rotulo: "15 dias" },
  { id: "mes", rotulo: "Mês" },
];

// Compara um indicador com o período anterior. `subirEhBom` diz qual seta é
// boa: margem e ROAS sobem quando vai bem.
function comparativo(
  atual: number | null,
  anterior: number | null,
  unidade: string,
  subirEhBom: boolean
): { texto: string; classe: string } | null {
  if (atual === null || anterior === null) return null;
  const diff = Math.round((atual - anterior) * 10) / 10;
  if (diff === 0) return { texto: `= igual ao anterior`, classe: "controle-ads-neutro" };
  const subiu = diff > 0;
  const bom = subiu === subirEhBom;
  return {
    texto: `${subiu ? "▲" : "▼"} ${Math.abs(diff).toFixed(1)}${unidade} vs anterior`,
    classe: bom ? "controle-ads-melhorou" : "controle-ads-piorou",
  };
}

const formatarMargem = (m: number | null) => (m === null ? "—" : `${m.toFixed(1)}%`);
const formatarRoas = (r: number | null) => (r === null ? "—" : `${r.toFixed(2)}x`);

function Sparkline({ diario }: { diario: DiaControleAds[] }) {
  if (diario.length < 2) return null;
  const largura = 200;
  const altura = 44;
  const maximo = Math.max(1, ...diario.flatMap((d) => [d.gasto, d.faturamento]));
  const pontos = (valor: (d: DiaControleAds) => number) =>
    diario
      .map((d, i) => {
        const x = (i / (diario.length - 1)) * largura;
        const y = altura - (valor(d) / maximo) * (altura - 4) - 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  return (
    <svg className="controle-ads-sparkline" viewBox={`0 0 ${largura} ${altura}`} preserveAspectRatio="none" role="img" aria-label="Venda e gasto por dia">
      <polyline points={pontos((d) => d.faturamento)} style={{ stroke: "var(--good-text)" }} />
      <polyline points={pontos((d) => d.gasto)} style={{ stroke: "var(--critical-text)" }} />
    </svg>
  );
}

function CartaoConta({
  conta,
  metaPadrao,
  onMetaSalva,
}: {
  conta: ContaControleAds;
  metaPadrao: MetaControleAds;
  onMetaSalva: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [motor, setMotor] = useState(String(conta.meta.motorMinimo));
  const [atencao, setAtencao] = useState(String(conta.meta.atencaoMinimo));
  const [erroMeta, setErroMeta] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const compMargem = comparativo(conta.margemPosAds, conta.anterior.margemPosAds, " pp", true);
  const compRoas = comparativo(conta.roas, conta.anterior.roas, "x", true);

  async function salvar() {
    setErroMeta(null);
    setSalvando(true);
    try {
      await salvarMetaControleAds(conta.lojaId, { motorMinimo: Number(motor), atencaoMinimo: Number(atencao) });
      setEditando(false);
      onMetaSalva();
    } catch (err) {
      setErroMeta(err instanceof Error ? err.message : "Falha ao salvar a meta.");
    } finally {
      setSalvando(false);
    }
  }

  function cancelar() {
    setMotor(String(conta.meta.motorMinimo));
    setAtencao(String(conta.meta.atencaoMinimo));
    setErroMeta(null);
    setEditando(false);
  }

  return (
    <div className={`controle-ads-card controle-ads-card-${conta.nivel}`}>
      <div className="controle-ads-card-topo">
        <span className="controle-ads-nome">{conta.lojaNome}</span>
        <span className={`controle-ads-selo controle-ads-selo-${conta.nivel}`}>{ROTULOS[conta.nivel]}</span>
      </div>

      <div className="controle-ads-acos-linha">
        <div className="controle-ads-acos">{formatarMargem(conta.margemPosAds)}</div>
        {compMargem && <div className={`controle-ads-comp ${compMargem.classe}`}>{compMargem.texto}</div>}
      </div>
      <div className="financeiro-td-mudo">Margem pós Ads do período</div>

      <div
        className="controle-ads-barra"
        title={`Motor a partir de ${conta.meta.motorMinimo}% · Atenção a partir de ${conta.meta.atencaoMinimo}%`}
      >
        {conta.margemPosAds !== null && (
          <div
            className="controle-ads-barra-preenchida"
            style={{ width: `${posicaoNaEscala(conta.margemPosAds)}%` }}
          />
        )}
        <div className="controle-ads-marca" style={{ left: `${posicaoNaEscala(conta.meta.atencaoMinimo)}%` }} />
        <div className="controle-ads-marca" style={{ left: `${posicaoNaEscala(conta.meta.motorMinimo)}%` }} />
      </div>
      <div className="controle-ads-escala financeiro-td-mudo">
        <span>{MARGEM_MINIMA_ESCALA}%</span>
        <span>0%</span>
        <span>{MARGEM_MAXIMA_ESCALA}%</span>
      </div>

      <div className="controle-ads-roas-linha">
        <div>
          <div className="controle-ads-roas">ROAS {formatarRoas(conta.roas)}</div>
          <div className="financeiro-td-mudo">
            Equilíbrio {conta.roasEquilibrio === null ? "—" : `${conta.roasEquilibrio.toFixed(2)}x`}
          </div>
        </div>
        {compRoas && <div className={`controle-ads-comp ${compRoas.classe}`}>{compRoas.texto}</div>}
      </div>

      <Sparkline diario={conta.diario} />
      <div className="controle-ads-legenda-grafico financeiro-td-mudo">
        <span className="controle-ads-bolinha controle-ads-bolinha-venda" /> venda
        <span className="controle-ads-bolinha controle-ads-bolinha-gasto" /> gasto
      </div>

      <div className="controle-ads-valores">
        <span>Gasto {formatCurrency(conta.gasto)}</span>
        <span>Venda {formatCurrency(conta.faturamento)}</span>
      </div>
      <div className="controle-ads-valores">
        <span>Gasto sem venda {formatCurrency(conta.gastoSemVenda)}</span>
        <span className={conta.lucroAposAds === null ? "" : conta.lucroAposAds >= 0 ? "controle-ads-melhorou" : "controle-ads-piorou"}>
          Lucro após Ads {conta.lucroAposAds === null ? "sem custo cadastrado" : formatCurrency(conta.lucroAposAds)}
        </span>
      </div>

      {!editando ? (
        <div className="controle-ads-meta-linha">
          <span className="financeiro-td-mudo">
            Motor ≥ {conta.meta.motorMinimo}% · Atenção ≥ {conta.meta.atencaoMinimo}%
            {conta.metaPadrao ? " (padrão)" : ""}
          </span>
          <button className="btn-responder" onClick={() => setEditando(true)}>Editar meta</button>
        </div>
      ) : (
        <div className="controle-ads-meta-editor">
          <label>
            Margem mínima para motor (%)
            <input type="number" step="0.5" className="clonar-input" value={motor} onChange={(e) => setMotor(e.target.value)} />
          </label>
          <label>
            Margem mínima para atenção (%)
            <input type="number" step="0.5" className="clonar-input" value={atencao} onChange={(e) => setAtencao(e.target.value)} />
          </label>
          <div className="controle-ads-meta-botoes">
            <button className="btn-responder" onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar"}
            </button>
            <button className="btn-excluir" onClick={cancelar} disabled={salvando}>Cancelar</button>
          </div>
          {erroMeta && <div className="clonar-erro">{erroMeta}</div>}
          <span className="financeiro-td-mudo">
            Padrão do painel: motor ≥ {metaPadrao.motorMinimo}% · atenção ≥ {metaPadrao.atencaoMinimo}%
          </span>
        </div>
      )}
    </div>
  );
}

function ListaCampanhas({
  titulo,
  tom,
  itens,
  vazio,
}: {
  titulo: string;
  tom: "atencao" | "motor";
  itens: CampanhaControleAds[];
  vazio: string;
}) {
  return (
    <div className={`controle-ads-lista controle-ads-lista-${tom}`}>
      <div className="controle-ads-lista-titulo">{titulo}</div>
      {itens.length === 0 && <div className="financeiro-td-mudo">{vazio}</div>}
      {itens.map((c) => {
        const lucro = c.lucroEstimado ?? c.saldo;
        return (
          <div key={`${c.lojaId}-${c.campanhaId}`} className="controle-ads-item">
            <div className="controle-ads-item-topo">
              <span className="controle-ads-item-nome" title={c.nome}>{c.nome}</span>
              <span className="controle-ads-loja-tag">{c.lojaNome}</span>
            </div>
            <div className="controle-ads-valores">
              <span>Gasto {formatCurrency(c.gasto)}</span>
              <span>Venda {formatCurrency(c.faturamento)}</span>
              <span>ROAS {c.roas === null ? "sem venda" : `${c.roas.toFixed(2)}x`}</span>
            </div>
            <div className={`controle-ads-saldo ${lucro >= 0 ? "controle-ads-melhorou" : "controle-ads-piorou"}`}>
              {lucro >= 0 ? "Sobra" : "Perde"} {formatCurrency(Math.abs(lucro))}
              {c.lucroEstimado === null ? " (receita − gasto)" : " pós Ads (estimado)"}
              {c.status !== "active" && <span className="controle-ads-status"> · {c.status === "paused" ? "pausada" : c.status}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ControleAds() {
  const [periodo, setPeriodo] = useState<Periodo>("hoje");
  const [intervalo, setIntervalo] = useState(() => intervaloDoPeriodo("hoje"));
  const [recarregar, setRecarregar] = useState(0);
  const [dados, setDados] = useState<PainelControleAds | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const niveisAnteriores = useRef<Map<number, NivelControleAds> | null>(null);

  useEffect(() => {
    let ativo = true;
    setErro(null);
    niveisAnteriores.current = null;
    fetchPainelControleAds(intervalo.inicio, intervalo.fim)
      .then((d) => {
        if (ativo) setDados(d);
      })
      .catch((err) => {
        if (ativo) setErro(err instanceof Error ? err.message : "Falha ao carregar o controle de Ads.");
      });
    return () => {
      ativo = false;
    };
  }, [intervalo.inicio, intervalo.fim, recarregar]);

  // Avisa quando uma conta ENTRA em sangria enquanto a tela está aberta.
  // A primeira carga do período só guarda o estado — senão toda vez que você
  // troca o filtro ou abre a tela, avisaria de tudo de novo.
  useEffect(() => {
    if (!dados) return;
    const atuais = new Map(dados.contas.map((c) => [c.lojaId, c.nivel]));
    const antes = niveisAnteriores.current;
    if (antes && typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const c of dados.contas) {
        const estavaAntes = antes.get(c.lojaId);
        if (c.nivel === "sangria" && estavaAntes !== undefined && estavaAntes !== "sangria") {
          new Notification(`${c.lojaNome} entrou em sangria`, {
            body: `Margem pós Ads ${formatarMargem(c.margemPosAds)} no período.`,
          });
        }
      }
    }
    niveisAnteriores.current = atuais;
  }, [dados]);

  function escolherPeriodo(p: PeriodoPredefinido) {
    setPeriodo(p);
    setIntervalo(intervaloDoPeriodo(p));
  }

  const totalGasto = dados?.contas.reduce((s, c) => s + c.gasto, 0) ?? 0;
  const totalFaturamento = dados?.contas.reduce((s, c) => s + c.faturamento, 0) ?? 0;
  const totalSemVenda = dados?.contas.reduce((s, c) => s + c.gastoSemVenda, 0) ?? 0;
  const lucroTotal = dados?.contas.every((c) => c.lucroAposAds !== null)
    ? dados.contas.reduce((s, c) => s + (c.lucroAposAds ?? 0), 0)
    : null;
  const roasGeral = totalGasto > 0 ? totalFaturamento / totalGasto : null;
  const margemGeral = lucroTotal !== null && totalFaturamento > 0 ? (lucroTotal / totalFaturamento) * 100 : null;
  const contagem = (nivel: NivelControleAds) => dados?.contas.filter((c) => c.nivel === nivel).length ?? 0;

  return (
    <div className="controle-ads">
      <div className="controle-ads-topo">
        <span className="painel-eyebrow">Ads · pessoal</span>
        <h1>Controle de Ads</h1>
        <p className="painel-sub">Só as suas 4 lojas. Quem dá lucro depois do Ads, quem só queima dinheiro e onde ele escapa.</p>
      </div>

      <div className="controle-ads-filtros">
        <div className="tarefas-abas">
          {PERIODOS.map((p) => (
            <button
              key={p.id}
              className={`tarefas-aba ${periodo === p.id ? "tarefas-aba-ativa" : ""}`}
              onClick={() => escolherPeriodo(p.id)}
            >
              {p.rotulo}
            </button>
          ))}
          <button
            className={`tarefas-aba ${periodo === "livre" ? "tarefas-aba-ativa" : ""}`}
            onClick={() => setPeriodo("livre")}
          >
            Personalizado
          </button>
        </div>
        {periodo === "livre" && (
          <div className="controle-ads-datas">
            <input
              type="date"
              className="clonar-input"
              value={intervalo.inicio}
              onChange={(e) => setIntervalo((v) => ({ ...v, inicio: e.target.value }))}
            />
            <span className="financeiro-td-mudo">até</span>
            <input
              type="date"
              className="clonar-input"
              value={intervalo.fim}
              onChange={(e) => setIntervalo((v) => ({ ...v, fim: e.target.value }))}
            />
          </div>
        )}
      </div>

      {erro && <div className="clonar-erro">{erro}</div>}
      {!dados && !erro && <div className="state-message">Carregando contas...</div>}

      {dados && (
        <>
          <div className="controle-ads-resumo">
            <div className="controle-ads-resumo-item">
              <span className="financeiro-td-mudo">Margem pós Ads</span>
              <b className={margemGeral !== null && margemGeral < 0 ? "controle-ads-piorou" : "controle-ads-melhorou"}>
                {formatarMargem(margemGeral)}
              </b>
            </div>
            <div className="controle-ads-resumo-item">
              <span className="financeiro-td-mudo">ROAS geral</span>
              <b>{formatarRoas(roasGeral)}</b>
            </div>
            <div className="controle-ads-resumo-item">
              <span className="financeiro-td-mudo">Lucro após Ads</span>
              <b className={lucroTotal !== null && lucroTotal < 0 ? "controle-ads-piorou" : "controle-ads-melhorou"}>
                {lucroTotal === null ? "—" : formatCurrency(lucroTotal)}
              </b>
            </div>
            <div className="controle-ads-resumo-item">
              <span className="financeiro-td-mudo">Gasto total</span>
              <b>{formatCurrency(totalGasto)}</b>
            </div>
            <div className="controle-ads-resumo-item">
              <span className="financeiro-td-mudo">Gasto sem venda</span>
              <b className="controle-ads-piorou">{formatCurrency(totalSemVenda)}</b>
            </div>
            <div className="controle-ads-resumo-item controle-ads-selos">
              <span className="controle-ads-selo controle-ads-selo-sangria">{contagem("sangria")} sangrando</span>
              <span className="controle-ads-selo controle-ads-selo-atencao">{contagem("atencao")} atenção</span>
              <span className="controle-ads-selo controle-ads-selo-motor">{contagem("motor")} motor</span>
            </div>
          </div>

          <div className="controle-ads-listas">
            <ListaCampanhas
              titulo="ATENÇÃO:"
              tom="atencao"
              itens={dados.atencao}
              vazio="Nenhuma campanha abaixo do ROAS de equilíbrio. Bom sinal."
            />
            <ListaCampanhas
              titulo="MOTORES:"
              tom="motor"
              itens={dados.motores}
              vazio="Nenhuma campanha dando lucro depois do Ads no período."
            />
          </div>

          <div className="controle-ads-legenda financeiro-td-mudo">
            Classificação pela margem pós Ads (lucro depois de custo, taxa, frete e Ads, sobre o faturamento).
            Padrão: motor ≥ {dados.metaPadrao.motorMinimo}% · atenção ≥ {dados.metaPadrao.atencaoMinimo}% · abaixo disso, sangria.
            ROAS = faturamento ÷ gasto. Equilíbrio = ROAS mínimo para não dar prejuízo. Comparando com {dados.anterior.inicio} a {dados.anterior.fim}.
          </div>

          <div className="controle-ads-grade">
            {dados.contas.map((conta) => (
              <CartaoConta
                key={conta.lojaId}
                conta={conta}
                metaPadrao={dados.metaPadrao}
                onMetaSalva={() => setRecarregar((n) => n + 1)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
