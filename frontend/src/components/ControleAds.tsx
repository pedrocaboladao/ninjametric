import { useEffect, useState } from "react";
import type { NivelControleAds, PainelControleAds } from "../types/controleAds";
import { fetchPainelControleAds } from "../api/controleAds";
import { formatCurrency } from "../utils/format";
import "./ControleAds.css";

// ACOS de 40% ou mais enche a barra. Acima disso a barra fica cheia, mas o número continua real.
const ACOS_ESCALA_MAXIMA = 40;

const ROTULOS: Record<NivelControleAds, string> = {
  motor: "MOTOR",
  atencao: "ATENÇÃO",
  sangria: "SANGRIA",
  sem_dados: "SEM DADOS",
};

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

export function ControleAds() {
  const [periodo, setPeriodo] = useState<Periodo>("hoje");
  const [intervalo, setIntervalo] = useState(() => intervaloDoPeriodo("hoje"));
  const [dados, setDados] = useState<PainelControleAds | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    setErro(null);
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
  }, [intervalo.inicio, intervalo.fim]);

  function escolherPeriodo(p: PeriodoPredefinido) {
    setPeriodo(p);
    setIntervalo(intervaloDoPeriodo(p));
  }

  const totalGasto = dados?.contas.reduce((s, c) => s + c.gasto, 0) ?? 0;
  const totalFaturamento = dados?.contas.reduce((s, c) => s + c.faturamento, 0) ?? 0;
  const acosGeral = totalFaturamento > 0 ? (totalGasto / totalFaturamento) * 100 : null;
  const contagem = (nivel: NivelControleAds) => dados?.contas.filter((c) => c.nivel === nivel).length ?? 0;

  return (
    <div className="controle-ads">
      <div className="controle-ads-topo">
        <span className="painel-eyebrow">Ads · pessoal</span>
        <h1>Controle de Ads</h1>
        <p className="painel-sub">Quem está sangrando e quem está pagando, conta por conta do Mercado Livre.</p>
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
              <span className="financeiro-td-mudo">Gasto total</span>
              <b>{formatCurrency(totalGasto)}</b>
            </div>
            <div className="controle-ads-resumo-item">
              <span className="financeiro-td-mudo">Faturamento</span>
              <b>{formatCurrency(totalFaturamento)}</b>
            </div>
            <div className="controle-ads-resumo-item">
              <span className="financeiro-td-mudo">ACOS geral</span>
              <b>{acosGeral === null ? "—" : `${acosGeral.toFixed(1)}%`}</b>
            </div>
            <div className="controle-ads-resumo-item controle-ads-selos">
              <span className="controle-ads-selo controle-ads-selo-sangria">{contagem("sangria")} sangrando</span>
              <span className="controle-ads-selo controle-ads-selo-atencao">{contagem("atencao")} atenção</span>
              <span className="controle-ads-selo controle-ads-selo-motor">{contagem("motor")} motor</span>
            </div>
          </div>

          <div className="controle-ads-legenda financeiro-td-mudo">
            Motor até ACOS {dados.limites.motorAte}% · Atenção até {dados.limites.atencaoAte}% · Sangria acima disso.
            ACOS = gasto com Ads ÷ faturamento.
          </div>

          <div className="controle-ads-grade">
            {dados.contas.map((conta) => {
              const larguraBarra = conta.acos === null ? 0 : Math.min((conta.acos / ACOS_ESCALA_MAXIMA) * 100, 100);
              return (
                <div key={conta.lojaId} className={`controle-ads-card controle-ads-card-${conta.nivel}`}>
                  <div className="controle-ads-card-topo">
                    <span className="controle-ads-nome">{conta.lojaNome}</span>
                    <span className={`controle-ads-selo controle-ads-selo-${conta.nivel}`}>{ROTULOS[conta.nivel]}</span>
                  </div>
                  <div className="controle-ads-acos">{conta.acos === null ? "—" : `${conta.acos.toFixed(1)}%`}</div>
                  <div className="financeiro-td-mudo">ACOS</div>
                  <div className="controle-ads-barra">
                    <div className="controle-ads-barra-preenchida" style={{ width: `${larguraBarra}%` }} />
                  </div>
                  <div className="controle-ads-valores">
                    <span>Gasto {formatCurrency(conta.gasto)}</span>
                    <span>Venda {formatCurrency(conta.faturamento)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
