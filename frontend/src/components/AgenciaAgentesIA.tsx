import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  fetchFeedAds,
  verificarAgenteAdsAgora,
  confirmarObservacaoAds,
  fetchPensamentosAds,
  perguntarAgenteAds,
} from "../api/agentes";
import type { ObservacaoAds, PensamentoAds, MensagemChat } from "../types/agentes";
import { formatDataHora } from "../utils/format";

const TAG_POR_TIPO: Record<string, { tag: string; cor: string }> = {
  prejuizo: { tag: "Prejuízo líquido", cor: "var(--critical-text)" },
  semVenda: { tag: "Sem venda, gastando", cor: "#fbbf24" },
  margemSobra: { tag: "Margem sobrando", cor: "#38bdf8" },
  orcamentoParado: { tag: "Orçamento parado", cor: "var(--good-text)" },
  organico: { tag: "Pode ser orgânico", cor: "#fbbf24" },
};

// Robô parado num ambiente (só chão + paredes, sem móveis) com um balão de
// fala animado (efeito "digitando...") ao lado. Desenhado à mão em SVG, no
// mesmo espírito dos ícones de components/icons.tsx.

const TILE_W = 30;
const TILE_H = 15;
const GRID = 5;
const WALL_H = 70;
const ORIGEM_X = 150;
const ORIGEM_Y = 90;

const COR_PAREDE = "#3f66c4";
const COR_PISO_1 = "#c9a06c";
const COR_PISO_2 = "#b98f57";

interface Ponto {
  x: number;
  y: number;
}

function isoPoint(x: number, y: number): Ponto {
  return { x: ORIGEM_X + (x - y) * (TILE_W / 2), y: ORIGEM_Y + (x + y) * (TILE_H / 2) };
}

function pontosStr(pts: Ponto[]): string {
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

// Clareia (fator > 1) ou escurece (fator < 1) uma cor hex — usado pra
// sombrear as duas paredes a partir de uma cor base só.
function sombrear(hex: string, fator: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const ajustar = (c: number) => Math.max(0, Math.min(255, Math.round(c * fator)));
  const paraHex = (c: number) => ajustar(c).toString(16).padStart(2, "0");
  return `#${paraHex(r)}${paraHex(g)}${paraHex(b)}`;
}

// Balão de chat com 3 pontinhos que "pulsam" em sequência, tipo indicador
// de "digitando" de app de mensagem.
function BalaoFala() {
  return (
    <g className="agente-balao">
      <path
        d="M4 2 H60 A6 6 0 0 1 66 8 V30 A6 6 0 0 1 60 36 H20 L10 46 V36 H4 A6 6 0 0 1 -2 30 V8 A6 6 0 0 1 4 2 Z"
        transform="translate(2,0)"
        fill="var(--bg-panel-alt)"
        stroke="var(--border-strong)"
        strokeWidth="1.5"
      />
      <circle className="agente-ponto agente-ponto-1" cx={20} cy={19} r={3.2} fill="var(--text-secondary)" />
      <circle className="agente-ponto agente-ponto-2" cx={34} cy={19} r={3.2} fill="var(--text-secondary)" />
      <circle className="agente-ponto agente-ponto-3" cx={48} cy={19} r={3.2} fill="var(--text-secondary)" />
    </g>
  );
}

// Personagem robô, estilo ilustração plana (formas arredondadas, cores
// vivas). Olhos reagem a ter pendência ou não.
function Personagem({ pe, cor }: { pe: Ponto; cor: string }) {
  return (
    <g transform={`translate(${pe.x}, ${pe.y})`}>
      <ellipse cx={0} cy={2} rx={26} ry={7} fill="rgba(0,0,0,0.3)" />
      {/* CSS anima o transform do grupo interno (flutuar) — se fosse no
          mesmo <g> do translate de posicionamento acima, a animação
          substituiria esse posicionamento em vez de somar. */}
      <g className="agente-personagem">
        <rect x={-21} y={-52} width={42} height={39} rx={13} fill="#eef2fb" stroke="#aebfe0" strokeWidth="2" />
        <rect x={-14} y={-41} width={28} height={8} rx={4} fill="var(--accent)" />
        <circle cx={-9} cy={-25} r={6} fill={cor} className="agente-olho" />
        <circle cx={9} cy={-25} r={6} fill={cor} className="agente-olho" />
        <rect x={-2} y={-63} width={4} height={12} fill="#aebfe0" />
        <circle cx={0} cy={-64} r={5.5} fill={cor} />
        <rect x={-17} y={-13} width={34} height={29} rx={10} fill="#dbe4f5" stroke="#aebfe0" strokeWidth="2" />
        <rect x={-10} y={-3} width={20} height={7} rx={3.5} fill="var(--accent)" />
      </g>
      <g transform="translate(24, -104)">
        <BalaoFala />
      </g>
    </g>
  );
}

function IlustracaoAgente({ alerta }: { alerta: boolean }) {
  const cor = alerta ? "var(--critical-text)" : "var(--good-text)";

  const costas = isoPoint(0, 0);
  const cantoDireito = isoPoint(GRID, 0);
  const cantoEsquerdo = isoPoint(0, GRID);
  const paredeEsquerda = pontosStr([
    cantoEsquerdo,
    costas,
    { x: costas.x, y: costas.y - WALL_H },
    { x: cantoEsquerdo.x, y: cantoEsquerdo.y - WALL_H },
  ]);
  const paredeDireita = pontosStr([
    costas,
    cantoDireito,
    { x: cantoDireito.x, y: cantoDireito.y - WALL_H },
    { x: costas.x, y: costas.y - WALL_H },
  ]);

  const tiles = [];
  for (let gx = 0; gx < GRID; gx++) {
    for (let gy = 0; gy < GRID; gy++) {
      const p0 = isoPoint(gx, gy);
      const p1 = isoPoint(gx + 1, gy);
      const p2 = isoPoint(gx + 1, gy + 1);
      const p3 = isoPoint(gx, gy + 1);
      const escuro = (gx + gy) % 2 === 0;
      tiles.push(
        <polygon
          key={`${gx}-${gy}`}
          points={pontosStr([p0, p1, p2, p3])}
          fill={escuro ? COR_PISO_1 : COR_PISO_2}
          stroke={sombrear(COR_PISO_2, 0.7)}
          strokeWidth="0.5"
        />
      );
    }
  }

  const pePersonagem = isoPoint(2, 3.4);

  return (
    <svg viewBox="0 0 300 220" className="agente-svg" role="img" aria-label="Sala do agente Analista de Ads">
      <polygon points={paredeEsquerda} fill={sombrear(COR_PAREDE, 0.65)} stroke={sombrear(COR_PAREDE, 0.4)} strokeWidth="1" />
      <polygon points={paredeDireita} fill={sombrear(COR_PAREDE, 0.9)} stroke={sombrear(COR_PAREDE, 0.4)} strokeWidth="1" />
      {tiles}
      <Personagem pe={pePersonagem} cor={cor} />
    </svg>
  );
}

function ObservacaoCard({
  observacao: o,
  onConfirmar,
}: {
  observacao: ObservacaoAds;
  onConfirmar: (id: number) => void;
}) {
  const info = TAG_POR_TIPO[o.tipo] ?? { tag: o.tipo, cor: "var(--text-muted)" };
  const resolvida = o.status === "resolvida";
  return (
    <div className={`agente-card ${resolvida ? "agente-card-resolvida" : ""}`} style={{ borderLeftColor: info.cor }}>
      <div className="agente-card-topo">
        <span className="ads-insight-tag" style={{ color: info.cor }}>
          {info.tag}
        </span>
        <span className="financeiro-td-mudo">{formatDataHora(o.criadoEm)}</span>
      </div>
      <div className="financeiro-td-titulo">{o.campanhaNome}</div>
      <div className="financeiro-td-mudo">{o.lojaNome}</div>
      <p className="ads-insight-contexto">{o.contexto}</p>
      <div className="ads-insight-acao">→ {o.acao}</div>
      {!resolvida && (
        <button type="button" className="btn-responder agente-card-confirmar" onClick={() => onConfirmar(o.id)}>
          Confirmar
        </button>
      )}
      {resolvida && (
        <span className="financeiro-td-mudo">
          {o.resolvidoPor === "usuario" ? "Confirmada por você" : "Resolvida sozinha"}
          {o.resolvidoEm && ` em ${formatDataHora(o.resolvidoEm)}`}
        </span>
      )}
    </div>
  );
}

// Raciocínio real da IA (não é texto inventado pra decoração — é o
// conteúdo dos blocos "thinking" que a própria Claude devolve, ver
// backend/src/services/agenteAdsService.ts). Um card por rodada de
// verificação, texto corrido preservando as quebras de linha originais.
function PensamentoCard({ pensamento }: { pensamento: PensamentoAds }) {
  const [expandido, setExpandido] = useState(false);
  return (
    <div className="agente-pensamento-card">
      <span className="financeiro-td-mudo">{formatDataHora(pensamento.criadoEm)}</span>
      <p className={`agente-pensamento-texto ${expandido ? "agente-pensamento-expandido" : ""}`}>
        {pensamento.pensamento}
      </p>
      <button type="button" className="agente-pensamento-toggle" onClick={() => setExpandido((v) => !v)}>
        {expandido ? "Mostrar menos" : "Ler tudo"}
      </button>
    </div>
  );
}

// Pergunta livre pro agente — mantém o histórico só na memória da página
// (não persiste como o feed/pensamentos), a cada pergunta ele busca os
// dados atuais das campanhas de novo no backend, então a resposta nunca
// fica desatualizada.
function ChatAgente() {
  const [mensagens, setMensagens] = useState<MensagemChat[]>([]);
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroChat, setErroChat] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const pergunta = input.trim();
    if (!pergunta || enviando) return;

    const historico = mensagens;
    setMensagens((m) => [...m, { papel: "usuario", texto: pergunta }]);
    setInput("");
    setErroChat(null);
    setEnviando(true);
    try {
      const resposta = await perguntarAgenteAds(pergunta, historico);
      setMensagens((m) => [...m, { papel: "agente", texto: resposta }]);
    } catch (err) {
      setErroChat(err instanceof Error ? err.message : "Falha ao perguntar pro agente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="agente-chat">
      <div className="agente-feed-topo">
        <span className="painel-eyebrow">Perguntar pro agente</span>
      </div>

      {mensagens.length === 0 && (
        <div className="state-message">
          Pergunte algo sobre suas campanhas de Ads — ele responde com os dados atuais das suas 4 lojas.
        </div>
      )}

      {mensagens.length > 0 && (
        <div className="agente-chat-mensagens">
          {mensagens.map((m, i) => (
            <div key={i} className={`agente-chat-msg agente-chat-msg-${m.papel}`}>
              <p>{m.texto}</p>
            </div>
          ))}
          {enviando && (
            <div className="agente-chat-msg agente-chat-msg-agente agente-chat-msg-carregando">
              <p>Pensando...</p>
            </div>
          )}
        </div>
      )}

      {erroChat && <div className="state-message state-error">{erroChat}</div>}

      <form className="agente-chat-form" onSubmit={enviar}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ex: qual campanha está no prejuízo agora?"
          disabled={enviando}
        />
        <button type="submit" className="btn-responder" disabled={enviando || !input.trim()}>
          Enviar
        </button>
      </form>
    </div>
  );
}

export function AgenciaAgentesIA() {
  const [feed, setFeed] = useState<ObservacaoAds[] | null>(null);
  const [pensamentos, setPensamentos] = useState<PensamentoAds[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [mostrarResolvidas, setMostrarResolvidas] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [feedNovo, pensamentosNovos] = await Promise.all([fetchFeedAds(), fetchPensamentosAds()]);
      setFeed(feedNovo);
      setPensamentos(pensamentosNovos);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao carregar o feed.");
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function verificarAgora() {
    setVerificando(true);
    setErro(null);
    try {
      await verificarAgenteAdsAgora();
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao verificar.");
    } finally {
      setVerificando(false);
    }
  }

  async function confirmar(id: number) {
    try {
      await confirmarObservacaoAds(id);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao confirmar.");
    }
  }

  const pendentes = feed?.filter((o) => o.status === "pendente") ?? [];
  const resolvidas = feed?.filter((o) => o.status === "resolvida") ?? [];
  const visiveis = mostrarResolvidas ? [...pendentes, ...resolvidas] : pendentes;

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <span className="painel-eyebrow">Agência de Agentes IA</span>
          <h1>Analista de Ads</h1>
          <p className="painel-sub">
            Observa suas campanhas de Ads sozinho e comenta aqui o que encontra — ACOS fora da meta, campanha no
            prejuízo, orçamento parado. Só comenta e sugere; nenhuma ação real acontece no Mercado Livre sem você
            confirmar.
          </p>
        </div>
        <div className="financeiro-filtros">
          <button
            type="button"
            className="btn-responder financeiro-btn-hoje"
            onClick={verificarAgora}
            disabled={verificando}
          >
            {verificando ? "Verificando..." : "Verificar agora"}
          </button>
        </div>
      </div>

      {erro && <div className="state-message state-error">{erro}</div>}

      <div className="agente-mesa">
        <IlustracaoAgente alerta={pendentes.length > 0} />
        <div className="agente-status">
          {feed === null ? (
            <span className="financeiro-td-mudo">Carregando...</span>
          ) : (
            <>
              {pensamentos && pensamentos.length > 0 ? (
                <p className="agente-status-pensamento">{pensamentos[0].pensamento}</p>
              ) : (
                <span className="financeiro-td-mudo">Ainda sem nenhuma verificação registrada.</span>
              )}
              {pendentes.length === 0 ? (
                <span className="financeiro-margem-positiva">Tudo certo por aqui — nenhuma pendência.</span>
              ) : (
                <span className="financeiro-margem-negativa">
                  {pendentes.length} observaç{pendentes.length !== 1 ? "ões" : "ão"} pendente
                  {pendentes.length !== 1 ? "s" : ""}.
                </span>
              )}
            </>
          )}
        </div>
      </div>

      <ChatAgente />

      <div className="agente-feed">
        <div className="agente-feed-topo">
          <span className="painel-eyebrow">Feed</span>
          <label className="usuarios-permissao-item">
            <input
              type="checkbox"
              checked={mostrarResolvidas}
              onChange={(e) => setMostrarResolvidas(e.target.checked)}
            />
            Mostrar resolvidas ({resolvidas.length})
          </label>
        </div>

        {feed !== null && visiveis.length === 0 && (
          <div className="state-message">Nenhuma observação{mostrarResolvidas ? "" : " pendente"} ainda.</div>
        )}

        {visiveis.map((o) => (
          <ObservacaoCard key={o.id} observacao={o} onConfirmar={confirmar} />
        ))}
      </div>

      {pensamentos !== null && pensamentos.length > 0 && (
        <div className="agente-feed agente-pensamentos-secao">
          <div className="agente-feed-topo">
            <span className="painel-eyebrow">O que ele está pensando</span>
          </div>
          {pensamentos.map((p) => (
            <PensamentoCard key={p.id} pensamento={p} />
          ))}
        </div>
      )}
    </div>
  );
}
