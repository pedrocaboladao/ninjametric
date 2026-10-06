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

const INTERVALO_ATUALIZACAO_MS = 5 * 60 * 1000;

const ROTULOS: Record<NivelControleAds, string> = {
  motor: "MOTOR",
  atencao: "ATENÇÃO",
  sangria: "SANGRIA",
  sem_dados: "SEM CUSTO",
};

function posicaoNaEscala(margem: number): number {
  const pct = ((margem - MARGEM_MINIMA_ESCALA) / (MARGEM_MAXIMA_ESCALA - MARGEM_MINIMA_ESCALA)) * 100;
  return Math.min(Math.max(pct, 0), 100);
}

function formatarData(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function hojeISO(): string {
  return formatarData(new Date());
}

// Mesmo critério do resto dos painéis: "7 dias" são 7 dias contando hoje.
function diasAtrasISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return formatarData(d);
}

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
      <div className="financeiro-td-mudo">Margem pós Ads da loja</div>

      <div
        className="controle-ads-barra"
        title={`Motor a partir de ${conta.meta.motorMinimo}% · Atenção a partir de ${conta.meta.atencaoMinimo}%`}
      >
        {conta.margemPosAds !== null && (
          <div className="controle-ads-barra-preenchida" style={{ width: `${posicaoNaEscala(conta.margemPosAds)}%` }} />
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
        <span>Gasto Ads {formatCurrency(conta.gasto)}</span>
        <span>Venda total {formatCurrency(conta.faturamento)}</span>
      </div>
      <div className="controle-ads-valores">
        <span>Receita atribuída {formatCurrency(conta.receitaAtribuida)}</span>
        <span>Sem venda {formatCurrency(conta.gastoSemVenda)}</span>
      </div>
      <div className={`controle-ads-lucro ${conta.lucroAposAds === null ? "" : conta.lucroAposAds >= 0 ? "controle-ads-melhorou" : "controle-ads-piorou"}`}>
        Lucro após Ads {conta.lucroAposAds === null ? "— (falta custo)" : formatCurrency(conta.lucroAposAds)}
      </div>
      {conta.vendasSemCusto > 0 && (
        <div className="controle-ads-alerta">
          {conta.vendasSemCusto} venda(s) sem custo na SKU MASTER — margem em branco até cadastrar:
          <span className="controle-ads-skus">{conta.skusSemCusto.join(", ")}</span>
        </div>
      )}

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

function ColunaCampanhas({
  titulo,
  nivel,
  itens,
  vazio,
}: {
  titulo: string;
  nivel: "sangria" | "atencao" | "motor";
  itens: CampanhaControleAds[];
  vazio: string;
}) {
  return (
    <div className={`controle-ads-lista controle-ads-lista-${nivel}`}>
      <div className="controle-ads-lista-titulo">
        {titulo} <span className="controle-ads-contagem">{itens.length}</span>
      </div>
      {itens.length === 0 && <div className="financeiro-td-mudo">{vazio}</div>}
      {itens.map((c) => (
        <div key={`${c.lojaId}-${c.campanhaId}`} className="controle-ads-item">
          <div className="controle-ads-item-topo">
            <span className="controle-ads-item-nome" title={c.nome}>{c.nome}</span>
            <span className="controle-ads-loja-tag">{c.lojaNome}</span>
          </div>
          <div className="controle-ads-valores">
            <span>Gasto {formatCurrency(c.gasto)}</span>
            <span>Receita {formatCurrency(c.receita)}</span>
            <span>ROAS {formatarRoas(c.roas)}</span>
          </div>
          <div className={`controle-ads-saldo ${c.lucroAposAds === null ? "" : c.lucroAposAds >= 0 ? "controle-ads-melhorou" : "controle-ads-piorou"}`}>
            Margem pós Ads {formatarMargem(c.margemPosAds)}
            {c.lucroAposAds !== null && <> · {formatCurrency(c.lucroAposAds)}</>}
            {c.itensSemCusto > 0 && <span className="controle-ads-status"> · {c.itensSemCusto} item(ns) sem custo</span>}
            {c.status !== "active" && <span className="controle-ads-status"> · {c.status === "paused" ? "pausada" : c.status}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ControleAds() {
  const [dataInicio, setDataInicio] = useState(hojeISO);
  const [dataFim, setDataFim] = useState(hojeISO);
  const [lojaFiltro, setLojaFiltro] = useState<"todas" | number>("todas");
  const [recarregar, setRecarregar] = useState(0);
  const [dados, setDados] = useState<PainelControleAds | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<Date | null>(null);
  const forcarAtualizacao = useRef(false);
  const niveisAnteriores = useRef<Map<number, NivelControleAds> | null>(null);

  // Trocar o período recomeça a comparação de sangria. Atualizações automáticas
  // no mesmo período NÃO recomeçam, senão a transição nunca seria percebida.
  useEffect(() => {
    niveisAnteriores.current = null;
  }, [dataInicio, dataFim]);

  // Atualização automática a cada 5 min, só com a aba visível. Força a busca
  // no Mercado Livre, porque o cache de 15 min seria maior que o intervalo.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      forcarAtualizacao.current = true;
      setRecarregar((n) => n + 1);
    }, INTERVALO_ATUALIZACAO_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (dataInicio > dataFim) {
      setErro("A data inicial é maior que a final.");
      return;
    }
    let ativo = true;
    const atualizar = forcarAtualizacao.current;
    forcarAtualizacao.current = false;
    setErro(null);
    setAtualizando(atualizar);
    fetchPainelControleAds(dataInicio, dataFim, atualizar)
      .then((d) => {
        if (ativo) {
          setDados(d);
          setUltimaAtualizacao(new Date());
        }
      })
      .catch((err) => {
        if (ativo) setErro(err instanceof Error ? err.message : "Falha ao carregar o controle de Ads.");
      })
      .finally(() => {
        if (ativo) setAtualizando(false);
      });
    return () => {
      ativo = false;
    };
  }, [dataInicio, dataFim, recarregar]);

  // Avisa quando uma loja ENTRA em sangria enquanto a tela está aberta.
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

  function atualizarAgora() {
    forcarAtualizacao.current = true;
    setRecarregar((n) => n + 1);
  }

  const contasVisiveis = (dados?.contas ?? []).filter((c) => lojaFiltro === "todas" || c.lojaId === lojaFiltro);
  const campanhasVisiveis = (dados?.campanhas ?? []).filter((c) => lojaFiltro === "todas" || c.lojaId === lojaFiltro);

  const totalGasto = contasVisiveis.reduce((s, c) => s + c.gasto, 0);
  const totalFaturamento = contasVisiveis.reduce((s, c) => s + c.faturamento, 0);
  const totalAtribuido = contasVisiveis.reduce((s, c) => s + c.receitaAtribuida, 0);
  const totalGastoAtribuido = contasVisiveis.reduce((s, c) => s + c.gastoAtribuido, 0);
  const totalSemVenda = contasVisiveis.reduce((s, c) => s + c.gastoSemVenda, 0);
  const lucroTotal = contasVisiveis.length > 0 && contasVisiveis.every((c) => c.lucroAposAds !== null)
    ? contasVisiveis.reduce((s, c) => s + (c.lucroAposAds ?? 0), 0)
    : null;
  const roasGeral = totalGastoAtribuido > 0 ? totalAtribuido / totalGastoAtribuido : null;
  const margemGeral = lucroTotal !== null && totalFaturamento > 0 ? (lucroTotal / totalFaturamento) * 100 : null;
  const contagemLoja = (nivel: NivelControleAds) => contasVisiveis.filter((c) => c.nivel === nivel).length;
  const campanhasDo = (nivel: NivelControleAds) =>
    campanhasVisiveis
      .filter((c) => c.nivel === nivel)
      .sort((a, b) => (a.margemPosAds ?? 0) - (b.margemPosAds ?? 0));

  return (
    <div className="controle-ads">
      <div className="controle-ads-topo">
        <span className="painel-eyebrow">Ads · pessoal</span>
        <h1>Controle de Ads</h1>
        <p className="painel-sub">Só as suas 4 lojas. Quem dá lucro depois do Ads, quem só queima dinheiro e onde ele escapa.</p>
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
              setDataInicio(diasAtrasISO(6));
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
          {ultimaAtualizacao && (
            <span className="financeiro-td-mudo">
              Atualizado às {ultimaAtualizacao.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · auto a cada 5 min
            </span>
          )}
        </div>
        <select
          className="dashboard-select"
          value={lojaFiltro}
          onChange={(e) => setLojaFiltro(e.target.value === "todas" ? "todas" : Number(e.target.value))}
        >
          <option value="todas">Todas as lojas</option>
          {(dados?.contas ?? []).map((c) => (
            <option key={c.lojaId} value={c.lojaId}>
              {c.lojaNome}
            </option>
          ))}
        </select>
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
              <span className="financeiro-td-mudo">ROAS (atribuído)</span>
              <b>{formatarRoas(roasGeral)}</b>
            </div>
            <div className="controle-ads-resumo-item">
              <span className="financeiro-td-mudo">Lucro após Ads</span>
              <b className={lucroTotal !== null && lucroTotal < 0 ? "controle-ads-piorou" : "controle-ads-melhorou"}>
                {lucroTotal === null ? "— (falta custo)" : formatCurrency(lucroTotal)}
              </b>
            </div>
            <div className="controle-ads-resumo-item">
              <span className="financeiro-td-mudo">Gasto Ads</span>
              <b>{formatCurrency(totalGasto)}</b>
            </div>
            <div className="controle-ads-resumo-item">
              <span className="financeiro-td-mudo">Gasto sem venda</span>
              <b className="controle-ads-piorou">{formatCurrency(totalSemVenda)}</b>
            </div>
            <div className="controle-ads-resumo-item controle-ads-selos">
              <span className="controle-ads-selo controle-ads-selo-sangria">{contagemLoja("sangria")} lojas em sangria</span>
              <span className="controle-ads-selo controle-ads-selo-atencao">{contagemLoja("atencao")} atenção</span>
              <span className="controle-ads-selo controle-ads-selo-motor">{contagemLoja("motor")} motor</span>
            </div>
          </div>

          <div className="controle-ads-listas">
            <ColunaCampanhas
              titulo="SANGRIA"
              nivel="sangria"
              itens={campanhasDo("sangria")}
              vazio="Nenhuma campanha em sangria no período."
            />
            <ColunaCampanhas
              titulo="ATENÇÃO"
              nivel="atencao"
              itens={campanhasDo("atencao")}
              vazio="Nenhuma campanha na faixa de atenção."
            />
            <ColunaCampanhas
              titulo="MOTOR"
              nivel="motor"
              itens={campanhasDo("motor")}
              vazio="Nenhuma campanha no nível motor no período."
            />
          </div>

          {campanhasDo("sem_dados").length > 0 && (
            <div className="controle-ads-legenda financeiro-td-mudo">
              {campanhasDo("sem_dados").length} campanha(s) sem custo completo na SKU MASTER — ficam fora das colunas até cadastrar.
            </div>
          )}

          <div className="controle-ads-legenda financeiro-td-mudo">
            Margem pós Ads = (margem de contribuição − gasto com Ads) ÷ faturamento. Custo do produto vem da planilha SKU MASTER.
            Campanha: cada anúncio usa a margem % dos seus pedidos no período. ROAS = receita atribuída pelo ML ÷ gasto.
            Padrão: motor ≥ {dados.metaPadrao.motorMinimo}% · atenção ≥ {dados.metaPadrao.atencaoMinimo}% · abaixo disso, sangria.
            Comparando com {dados.anterior.inicio} a {dados.anterior.fim}.
          </div>

          <div className="controle-ads-grade">
            {contasVisiveis.map((conta) => (
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
