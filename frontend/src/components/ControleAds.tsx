import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CampanhaControleAds,
  ContaControleAds,
  DiaControleAds,
  MetaControleAds,
  NivelControleAds,
  PainelControleAds,
} from "../types/controleAds";
import { fetchPainelControleAds, salvarMetaControleAds } from "../api/controleAds";
import { Dispersao, LinhaDiaria, MiniArea, Rosca, Velocimetro, COR_NIVEL, type PontoDispersao } from "./ControleAdsGraficos";
import "./ControleAds.css";

const INTERVALO_ATUALIZACAO_MS = 5 * 60 * 1000;
const MARGEM_MIN = -20;
const MARGEM_MAX = 40;

const ROTULOS: Record<NivelControleAds, string> = {
  motor: "MOTOR",
  atencao: "ATENÇÃO",
  sangria: "SANGRIA",
  sem_dados: "SEM CUSTO",
};

const moedaCompacta = new Intl.NumberFormat("pt-BR", { notation: "compact", style: "currency", currency: "BRL" });
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

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

const formatarMargem = (m: number | null) => (m === null ? "—" : `${m.toFixed(1)}%`);
const formatarRoas = (r: number | null) => (r === null ? "—" : `${r.toFixed(2)}x`);
const formatarMoeda = (v: number | null) => (v === null ? "— (falta custo)" : moeda.format(v));

// Variação percentual contra o período anterior. Subir é "bom" só quando
// `subirEhBom` for verdadeiro (venda sobe = bom; gasto sobe = ruim).
function variacao(atual: number, anterior: number, subirEhBom: boolean): { texto: string; classe: string } | null {
  if (anterior <= 0) return null;
  const pct = ((atual - anterior) / anterior) * 100;
  const subiu = pct > 0;
  const bom = subiu === subirEhBom;
  return {
    texto: `${subiu ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}% vs anterior`,
    classe: bom ? "pbi-bom" : "pbi-ruim",
  };
}

function KpiTile({
  titulo,
  valor,
  sub,
  delta,
  serie,
  cor,
  corValor,
}: {
  titulo: string;
  valor: string;
  sub: string;
  delta?: { texto: string; classe: string } | null;
  serie?: number[];
  cor: string;
  corValor?: string;
}) {
  return (
    <div className="pbi-kpi" style={{ borderTopColor: cor }}>
      <div className="pbi-kpi-titulo">{titulo}</div>
      <div className="pbi-kpi-valor" style={corValor ? { color: corValor } : undefined}>{valor}</div>
      <div className="pbi-kpi-sub">
        {sub}
        {delta && <span className={`pbi-delta ${delta.classe}`}>{delta.texto}</span>}
      </div>
      {serie && <MiniArea valores={serie} cor={cor} />}
    </div>
  );
}

function LojaTile({
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

  const comp = variacao(conta.margemPosAds ?? 0, conta.anterior.margemPosAds ?? 0, true);

  return (
    <div className="pbi-loja" style={{ borderTopColor: COR_NIVEL[conta.nivel] }}>
      <div className="pbi-loja-topo">
        <span className="pbi-loja-nome">{conta.lojaNome}</span>
        <span className="pbi-pill" style={{ background: COR_NIVEL[conta.nivel] }}>{ROTULOS[conta.nivel]}</span>
      </div>
      <Velocimetro valor={conta.margemPosAds} min={MARGEM_MIN} max={MARGEM_MAX} atencao={conta.meta.atencaoMinimo} motor={conta.meta.motorMinimo} />
      <div className="pbi-loja-metricas">
        <div><span>ROAS</span><b>{formatarRoas(conta.roas)}</b></div>
        <div><span>Equilíbrio</span><b>{conta.roasEquilibrio === null ? "—" : `${conta.roasEquilibrio.toFixed(2)}x`}</b></div>
        <div><span>Lucro após Ads</span><b className={conta.lucroAposAds === null ? "" : conta.lucroAposAds >= 0 ? "pbi-bom" : "pbi-ruim"}>{formatarMoeda(conta.lucroAposAds)}</b></div>
        <div><span>Sem venda</span><b className="pbi-ruim">{moedaCompacta.format(conta.gastoSemVenda)}</b></div>
      </div>
      {comp && <div className={`pbi-loja-comp ${comp.classe}`}>margem {comp.texto}</div>}
      {conta.vendasSemCusto > 0 && (
        <div className="pbi-alerta">
          {conta.vendasSemCusto} venda(s) sem custo na SKU MASTER: <b>{conta.skusSemCusto.join(", ")}</b>
        </div>
      )}

      {!editando ? (
        <div className="pbi-loja-rodape">
          <span>Motor ≥ {conta.meta.motorMinimo}% · Atenção ≥ {conta.meta.atencaoMinimo}%{conta.metaPadrao ? " (padrão)" : ""}</span>
          <button className="pbi-botao-ghost" onClick={() => setEditando(true)}>Editar meta</button>
        </div>
      ) : (
        <div className="pbi-meta-editor">
          <label>Margem mínima motor (%)
            <input type="number" step="0.5" value={motor} onChange={(e) => setMotor(e.target.value)} />
          </label>
          <label>Margem mínima atenção (%)
            <input type="number" step="0.5" value={atencao} onChange={(e) => setAtencao(e.target.value)} />
          </label>
          <div className="pbi-meta-botoes">
            <button className="pbi-botao" onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</button>
            <button className="pbi-botao-ghost" onClick={cancelar} disabled={salvando}>Cancelar</button>
          </div>
          {erroMeta && <div className="pbi-erro">{erroMeta}</div>}
          <span className="pbi-muted">Padrão: motor ≥ {metaPadrao.motorMinimo}% · atenção ≥ {metaPadrao.atencaoMinimo}%</span>
        </div>
      )}
    </div>
  );
}

function ListaCampanhas({
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
    <div className="pbi-coluna" style={{ borderTopColor: COR_NIVEL[nivel] }}>
      <div className="pbi-coluna-titulo" style={{ color: COR_NIVEL[nivel] }}>
        {titulo} <span className="pbi-contagem">{itens.length}</span>
      </div>
      {itens.length === 0 && <div className="pbi-muted">{vazio}</div>}
      {itens.slice(0, 12).map((c) => (
        <div key={`${c.lojaId}-${c.campanhaId}`} className="pbi-item">
          <div className="pbi-item-topo">
            <span className="pbi-item-nome" title={c.nome}>{c.nome}</span>
            <span className="pbi-tag">{c.lojaNome}</span>
          </div>
          <div className="pbi-item-linha">
            <span>Gasto {moedaCompacta.format(c.gasto)}</span>
            <span>ROAS {formatarRoas(c.roas)}</span>
            <b style={{ color: COR_NIVEL[c.nivel] }}>{formatarMargem(c.margemPosAds)}</b>
          </div>
          {c.itensSemCusto > 0 && <div className="pbi-muted">{c.itensSemCusto} item(ns) sem custo</div>}
          {c.status !== "active" && <div className="pbi-muted">{c.status === "paused" ? "pausada" : c.status}</div>}
        </div>
      ))}
      {itens.length > 12 && <div className="pbi-muted">+ {itens.length - 12} campanhas</div>}
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
  // A primeira carga do período só guarda o estado.
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

  const contasVisiveis = useMemo(
    () => (dados?.contas ?? []).filter((c) => lojaFiltro === "todas" || c.lojaId === lojaFiltro),
    [dados, lojaFiltro]
  );
  const campanhasVisiveis = useMemo(
    () => (dados?.campanhas ?? []).filter((c) => lojaFiltro === "todas" || c.lojaId === lojaFiltro),
    [dados, lojaFiltro]
  );

  // Série diária somada entre as lojas visíveis (ou de uma loja só).
  const diarioSomado = useMemo<DiaControleAds[]>(() => {
    const mapa = new Map<string, DiaControleAds>();
    for (const c of contasVisiveis) {
      for (const d of c.diario) {
        const atual = mapa.get(d.data) ?? { data: d.data, gasto: 0, faturamento: 0 };
        atual.gasto += d.gasto;
        atual.faturamento += d.faturamento;
        mapa.set(d.data, atual);
      }
    }
    return [...mapa.values()].sort((a, b) => (a.data < b.data ? -1 : 1));
  }, [contasVisiveis]);

  const totalGasto = contasVisiveis.reduce((s, c) => s + c.gasto, 0);
  const totalFaturamento = contasVisiveis.reduce((s, c) => s + c.faturamento, 0);
  const totalAtribuido = contasVisiveis.reduce((s, c) => s + c.receitaAtribuida, 0);
  const totalGastoAtribuido = contasVisiveis.reduce((s, c) => s + c.gastoAtribuido, 0);
  const totalSemVenda = contasVisiveis.reduce((s, c) => s + c.gastoSemVenda, 0);
  const anteriorGasto = contasVisiveis.reduce((s, c) => s + c.anterior.gasto, 0);
  const anteriorFaturamento = contasVisiveis.reduce((s, c) => s + c.anterior.faturamento, 0);
  const lucroTotal =
    contasVisiveis.length > 0 && contasVisiveis.every((c) => c.lucroAposAds !== null)
      ? contasVisiveis.reduce((s, c) => s + (c.lucroAposAds ?? 0), 0)
      : null;
  const roasGeral = totalGastoAtribuido > 0 ? totalAtribuido / totalGastoAtribuido : null;
  const margemGeral = lucroTotal !== null && totalFaturamento > 0 ? (lucroTotal / totalFaturamento) * 100 : null;

  const distribuicao = useMemo(() => {
    const soma = (n: NivelControleAds) => campanhasVisiveis.filter((c) => c.nivel === n).reduce((s, c) => s + c.gasto, 0);
    return [
      { label: "Sangria", valor: soma("sangria"), cor: COR_NIVEL.sangria },
      { label: "Atenção", valor: soma("atencao"), cor: COR_NIVEL.atencao },
      { label: "Motor", valor: soma("motor"), cor: COR_NIVEL.motor },
      { label: "Sem custo", valor: soma("sem_dados"), cor: COR_NIVEL.sem_dados },
    ];
  }, [campanhasVisiveis]);

  const pontosDispersao: PontoDispersao[] = campanhasVisiveis
    .filter((c) => c.roas !== null && c.margemPosAds !== null)
    .map((c) => ({
      chave: `${c.lojaId}-${c.campanhaId}`,
      titulo: `${c.nome} (${c.lojaNome})`,
      x: c.roas as number,
      y: c.margemPosAds as number,
      gasto: c.gasto,
      nivel: c.nivel,
    }));

  const campanhasDo = (nivel: NivelControleAds) =>
    campanhasVisiveis.filter((c) => c.nivel === nivel).sort((a, b) => (a.margemPosAds ?? 0) - (b.margemPosAds ?? 0));
  const topGasto = [...campanhasVisiveis].sort((a, b) => b.gasto - a.gasto).slice(0, 10);
  const maiorGasto = Math.max(1, ...topGasto.map((c) => c.gasto));

  const deltaGasto = variacao(totalGasto, anteriorGasto, false);
  const deltaVenda = variacao(totalFaturamento, anteriorFaturamento, true);

  return (
    <div className="pbi">
      <div className="pbi-topo">
        <div>
          <span className="pbi-eyebrow">Ads · pessoal</span>
          <h1>Controle de Ads</h1>
        </div>
        <div className="pbi-filtros">
          <input type="date" value={dataInicio} max={dataFim} onChange={(e) => setDataInicio(e.target.value)} />
          <span>até</span>
          <input type="date" value={dataFim} min={dataInicio} max={hojeISO()} onChange={(e) => setDataFim(e.target.value)} />
          <button type="button" onClick={() => { setDataInicio(hojeISO()); setDataFim(hojeISO()); }}>Hoje</button>
          <button type="button" onClick={() => { setDataInicio(diasAtrasISO(6)); setDataFim(hojeISO()); }}>7 dias</button>
          <button type="button" onClick={atualizarAgora} disabled={atualizando} title="Buscar dados novos agora, sem esperar o cache">
            {atualizando ? "Atualizando..." : "Atualizar"}
          </button>
          <select value={lojaFiltro} onChange={(e) => setLojaFiltro(e.target.value === "todas" ? "todas" : Number(e.target.value))}>
            <option value="todas">Todas as lojas</option>
            {(dados?.contas ?? []).map((c) => (
              <option key={c.lojaId} value={c.lojaId}>{c.lojaNome}</option>
            ))}
          </select>
        </div>
        {ultimaAtualizacao && (
          <div className="pbi-muted">
            Atualizado às {ultimaAtualizacao.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · auto a cada 5 min
          </div>
        )}
      </div>

      {erro && <div className="pbi-erro">{erro}</div>}
      {!dados && !erro && <div className="pbi-vazio">Carregando contas...</div>}

      {dados && (
        <>
          <div className="pbi-kpis">
            <KpiTile
              titulo="Margem pós Ads"
              valor={formatarMargem(margemGeral)}
              sub={`Lucro ${formatarMoeda(lucroTotal)}`}
              cor={margemGeral !== null && margemGeral < 0 ? COR_NIVEL.sangria : COR_NIVEL.motor}
              corValor={margemGeral !== null && margemGeral < 0 ? COR_NIVEL.sangria : COR_NIVEL.motor}
            />
            <KpiTile
              titulo="ROAS atribuído"
              valor={formatarRoas(roasGeral)}
              sub={`Receita ${moedaCompacta.format(totalAtribuido)}`}
              cor="var(--pbi-azul)"
            />
            <KpiTile
              titulo="Lucro após Ads"
              valor={lucroTotal === null ? "—" : moedaCompacta.format(lucroTotal)}
              sub="margem de contribuição − Ads"
              cor={lucroTotal !== null && lucroTotal < 0 ? COR_NIVEL.sangria : COR_NIVEL.motor}
            />
            <KpiTile
              titulo="Gasto Ads"
              valor={moedaCompacta.format(totalGasto)}
              sub="no período"
              delta={deltaGasto}
              serie={diarioSomado.map((d) => d.gasto)}
              cor={COR_NIVEL.sangria}
            />
            <KpiTile
              titulo="Venda total"
              valor={moedaCompacta.format(totalFaturamento)}
              sub="faturamento das lojas"
              delta={deltaVenda}
              serie={diarioSomado.map((d) => d.faturamento)}
              cor={COR_NIVEL.motor}
            />
            <KpiTile
              titulo="Gasto sem venda"
              valor={moedaCompacta.format(totalSemVenda)}
              sub={totalGasto > 0 ? `${((totalSemVenda / totalGasto) * 100).toFixed(1)}% do gasto` : "—"}
              cor={COR_NIVEL.atencao}
            />
          </div>

          <div className="pbi-grade-2">
            <section className="pbi-card">
              <div className="pbi-card-titulo">Margem pós Ads por loja</div>
              <div className="pbi-lojas">
                {contasVisiveis.map((conta) => (
                  <LojaTile
                    key={conta.lojaId}
                    conta={conta}
                    metaPadrao={dados.metaPadrao}
                    onMetaSalva={() => setRecarregar((n) => n + 1)}
                  />
                ))}
              </div>
            </section>
            <section className="pbi-card">
              <div className="pbi-card-titulo">Onde o gasto está</div>
              <Rosca fatias={distribuicao} centro={moedaCompacta.format(distribuicao.reduce((s, f) => s + f.valor, 0))} />
            </section>
          </div>

          <div className="pbi-grade-2">
            <section className="pbi-card">
              <div className="pbi-card-titulo">Venda × gasto por dia</div>
              <LinhaDiaria diario={diarioSomado} />
            </section>
            <section className="pbi-card">
              <div className="pbi-card-titulo">ROAS × margem pós Ads por campanha</div>
              <div className="pbi-muted">Quanto maior a bolha, mais gasto. Acima de 0% dá lucro depois do Ads.</div>
              <Dispersao pontos={pontosDispersao} />
            </section>
          </div>

          <div className="pbi-grade-2">
            <section className="pbi-card">
              <div className="pbi-card-titulo">Campanhas que mais gastam</div>
              <div className="pbi-ranking">
                {topGasto.length === 0 && <div className="pbi-muted">Nenhuma campanha com gasto no período.</div>}
                {topGasto.map((c) => (
                  <div key={`${c.lojaId}-${c.campanhaId}`} className="pbi-rank-linha">
                    <div className="pbi-rank-texto">
                      <span title={c.nome}>{c.nome}</span>
                      <span className="pbi-tag">{c.lojaNome}</span>
                    </div>
                    <div className="pbi-rank-barra">
                      <div style={{ width: `${(c.gasto / maiorGasto) * 100}%`, background: COR_NIVEL[c.nivel] }} />
                    </div>
                    <div className="pbi-rank-valor">
                      {moedaCompacta.format(c.gasto)} · <b style={{ color: COR_NIVEL[c.nivel] }}>{formatarMargem(c.margemPosAds)}</b>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section className="pbi-card">
              <div className="pbi-card-titulo">Campanhas por faixa</div>
              <div className="pbi-colunas">
                <ListaCampanhas titulo="SANGRIA" nivel="sangria" itens={campanhasDo("sangria")} vazio="Nenhuma em sangria." />
                <ListaCampanhas titulo="ATENÇÃO" nivel="atencao" itens={campanhasDo("atencao")} vazio="Nenhuma na faixa de atenção." />
                <ListaCampanhas titulo="MOTOR" nivel="motor" itens={campanhasDo("motor")} vazio="Nenhuma no nível motor." />
              </div>
              {campanhasDo("sem_dados").length > 0 && (
                <div className="pbi-muted">
                  {campanhasDo("sem_dados").length} campanha(s) sem custo completo na SKU MASTER: fora das colunas até cadastrar.
                </div>
              )}
            </section>
          </div>

          <div className="pbi-rodape">
            Margem pós Ads = (margem de contribuição − gasto com Ads) ÷ faturamento. Custo do produto vem da planilha SKU MASTER.
            ROAS = receita atribuída pelo ML ÷ gasto. Comparando com {dados.anterior.inicio} a {dados.anterior.fim}.
          </div>
        </>
      )}
    </div>
  );
}
