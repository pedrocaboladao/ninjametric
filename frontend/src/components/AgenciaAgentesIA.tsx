import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import {
  fetchFeedAds,
  verificarAgenteAdsAgora,
  confirmarObservacaoAds,
  fetchPensamentosAds,
  perguntarAgenteAds,
  tratarFotoProduto,
  criarArtePromocional,
  gerarKitFotos,
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

function misturar(p1: Ponto, p2: Ponto, t: number): Ponto {
  return { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
}

// Interpola um ponto dentro de um quadrilátero (A=canto 0,0 · B=canto 1,0 ·
// C=canto 1,1 · D=canto 0,1) — usado pra encaixar conteúdo (gráfico da
// tela, lombada dos livros) alinhado com a face isométrica certa, em vez de
// desenhar "colado" por cima sem respeitar a perspectiva.
function dentroDaFace(A: Ponto, B: Ponto, C: Ponto, D: Ponto, u: number, v: number): Ponto {
  return misturar(misturar(A, B, u), misturar(D, C, u), v);
}

interface FaceQuad {
  A: Ponto;
  B: Ponto;
  C: Ponto;
  D: Ponto;
}

// Caixa 3D no grid isométrico — base de toda a mobília (mesa, monitor,
// estante, cadeira). "elevar" empilha caixas em cima de outras (ex.:
// monitor em cima da mesa). Devolve as 3 faces prontas pra desenhar mais a
// face direita "crua" (4 cantos), pra quem precisar encaixar conteúdo nela.
function caixaIso(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  altura: number,
  elevar: number,
  corBase: string,
  projetar: (x: number, y: number) => Ponto = isoPoint
) {
  const subir = (p: Ponto, h: number) => ({ x: p.x, y: p.y - h });
  const A = subir(projetar(x0, y0), elevar);
  const B = subir(projetar(x1, y0), elevar);
  const C = subir(projetar(x1, y1), elevar);
  const D = subir(projetar(x0, y1), elevar);
  const Ac = subir(A, altura);
  const Bc = subir(B, altura);
  const Cc = subir(C, altura);
  const Dc = subir(D, altura);
  const borda = sombrear(corBase, 0.5);
  // "esquerda" é a face voltada pra frente-esquerda (aresta D-C, onde x
  // varia) — normalmente a mais larga e a que fica de frente pro
  // personagem, então é nela que encaixamos conteúdo (tela do monitor,
  // lombada dos livros). "direita" (aresta B-C, y varia) fica de perfil.
  const faceEsquerda: FaceQuad = { A: D, B: C, C: Cc, D: Dc };
  const faceDireita: FaceQuad = { A: B, B: C, C: Cc, D: Bc };
  return {
    esquerda: (
      <polygon points={pontosStr([D, C, Cc, Dc])} fill={sombrear(corBase, 0.62)} stroke={borda} strokeWidth="0.5" />
    ),
    direita: <polygon points={pontosStr([B, C, Cc, Bc])} fill={sombrear(corBase, 0.85)} stroke={borda} strokeWidth="0.5" />,
    topo: <polygon points={pontosStr([Ac, Bc, Cc, Dc])} fill={sombrear(corBase, 1.18)} stroke={borda} strokeWidth="0.5" />,
    faceEsquerda,
    faceDireita,
  };
}

function Mobilia({
  x0,
  y0,
  x1,
  y1,
  altura,
  elevar = 0,
  cor,
}: {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  altura: number;
  elevar?: number;
  cor: string;
}) {
  const caixa = caixaIso(x0, y0, x1, y1, altura, elevar, cor);
  return (
    <g>
      {caixa.esquerda}
      {caixa.direita}
      {caixa.topo}
    </g>
  );
}

// Mesa com monitor em cima — a "tela" é um gráfico de linha ascendente
// encaixado na face isométrica certa (via dentroDaFace), com um ponto
// pulsando no fim pra dar a sensação de dado ao vivo.
function MesaComMonitor({ alerta }: { alerta: boolean }) {
  const mesa = caixaIso(2.3, 0.3, 4.3, 1.0, 24, 0, "#2b2f3a");
  const monitor = caixaIso(2.9, 0.42, 3.7, 0.6, 18, 24, "#14161d");
  const { A, B, C, D } = monitor.faceEsquerda;
  const valores = [0.15, 0.38, 0.3, 0.58, 0.48, 0.72, 0.9];
  const pontosGrafico = valores.map((v, i) => dentroDaFace(A, B, C, D, 0.12 + (i / (valores.length - 1)) * 0.76, 0.82 - v * 0.62));
  const linha = pontosGrafico.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const ponta = pontosGrafico[pontosGrafico.length - 1];
  const corLinha = alerta ? "var(--critical-text)" : "var(--good-text)";
  return (
    <g>
      {mesa.esquerda}
      {mesa.direita}
      {mesa.topo}
      {monitor.esquerda}
      {monitor.direita}
      {monitor.topo}
      <polygon points={pontosStr([A, B, C, D])} fill="#0c2a22" />
      <polyline
        points={linha}
        fill="none"
        stroke={corLinha}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="agente-grafico-linha"
      />
      <circle cx={ponta.x} cy={ponta.y} r={2.2} fill={corLinha} className="agente-grafico-ponto" />
    </g>
  );
}

// Estante contra a parede esquerda, com "lombadas" de livro encaixadas na
// face isométrica e um vasinho de planta no topo.
function Estante() {
  const caixa = caixaIso(0.2, 1.0, 0.9, 1.8, 58, 0, "#3a2e22");
  const { A, B, C, D } = caixa.faceEsquerda;
  const cores = ["#b0463c", "#3f66c4", "#e8b84b"];
  const livros = cores.map((cor, i) => {
    const p0 = dentroDaFace(A, B, C, D, 0.14 + i * 0.24, 0.5);
    const p1 = dentroDaFace(A, B, C, D, 0.3 + i * 0.24, 0.86);
    return (
      <rect
        key={cor}
        x={Math.min(p0.x, p1.x)}
        y={p0.y}
        width={Math.max(2, Math.abs(p1.x - p0.x))}
        height={Math.abs(p1.y - p0.y)}
        fill={cor}
      />
    );
  });
  const topoCentro = dentroDaFace(A, B, C, D, 0.5, 0);
  return (
    <g>
      {caixa.esquerda}
      {caixa.direita}
      {caixa.topo}
      {livros}
      <circle cx={topoCentro.x - 4} cy={topoCentro.y - 5} r={4.5} fill="#3f8f5c" />
      <circle cx={topoCentro.x + 3} cy={topoCentro.y - 7} r={3.5} fill="#4aa568" />
    </g>
  );
}

// Luminária de chão, com um brilho quentinho pulsando devagar.
function Luminaria() {
  const base = isoPoint(4.7, 1.1);
  const topo = { x: base.x, y: base.y - 56 };
  return (
    <g>
      <ellipse cx={base.x} cy={base.y} rx={5} ry={2.4} fill={sombrear("#5b4a35", 0.6)} />
      <line x1={base.x} y1={base.y} x2={topo.x} y2={topo.y} stroke="#5b4a35" strokeWidth="2" />
      <ellipse cx={topo.x} cy={topo.y - 6} rx={9} ry={5} fill="#f2e2b8" stroke={sombrear("#f2e2b8", 0.7)} strokeWidth="1" />
      <ellipse cx={topo.x} cy={topo.y - 3} rx={12} ry={9} fill="#fff4d6" opacity={0.3} className="agente-luz-brilho" />
    </g>
  );
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

// Corpo do personagem humano, estilo ilustração plana (formas arredondadas,
// cores vivas) — usado tanto parado (sala pequena) quanto andando (sala
// grande do Modo TV). "corStatus" é o crachá colorido no peito que reage a
// ter pendência ou não; sem ele, o personagem não carrega esse tipo de sinal.
function CorpoHumano({ cor, corStatus }: { cor: string; corStatus?: string }) {
  return (
    <g className="agente-personagem">
      <rect x={-9} y={-24} width={7} height={26} rx={3} fill="#2b2f3a" />
      <rect x={2} y={-24} width={7} height={26} rx={3} fill="#2b2f3a" />
      <rect x={-13} y={-52} width={26} height={32} rx={9} fill={cor} stroke={sombrear(cor, 0.7)} strokeWidth="1.5" />
      <rect x={-17} y={-49} width={6} height={22} rx={3} fill={cor} />
      <rect x={11} y={-49} width={6} height={22} rx={3} fill={cor} />
      <circle cx={0} cy={-62} r={12} fill="#e8b892" stroke="#c99569" strokeWidth="1.2" />
      <path d="M -12 -66 A 12 12 0 0 1 12 -66 L 12 -71 A 13 13 0 0 0 -12 -71 Z" fill="#3b2a1e" />
      <circle cx={-4} cy={-61} r={1.4} fill="#20232b" />
      <circle cx={4} cy={-61} r={1.4} fill="#20232b" />
      {corStatus && <circle cx={0} cy={-39} r={4} fill={corStatus} stroke="#fff" strokeWidth="1.2" />}
    </g>
  );
}

// Personagem humano parado, com balão de fala — usado na sala pequena de
// cada agente (um personagem só, sem animação de andar).
function PersonagemHumano({
  pe,
  cor,
  corStatus,
  escala = 1,
}: {
  pe: Ponto;
  cor: string;
  corStatus?: string;
  escala?: number;
}) {
  return (
    <g transform={`translate(${pe.x}, ${pe.y}) scale(${escala})`}>
      <ellipse cx={0} cy={2} rx={17} ry={5} fill="rgba(0,0,0,0.3)" />
      <CorpoHumano cor={cor} corStatus={corStatus} />
      <g transform="translate(16, -78) scale(0.75)">
        <BalaoFala />
      </g>
    </g>
  );
}

// Personagem humano andando de um lado pro outro (mesa ↔ área comum) — sem
// atributo "transform" estático no grupo animado (só a animação CSS cuida
// da posição), pra não repetir o gotcha de atributo x animação brigando.
function PersonagemAndante({
  id,
  deskPe,
  comumPe,
  cor,
  corStatus,
  escala = 1,
}: {
  id: string;
  deskPe: Ponto;
  comumPe: Ponto;
  cor: string;
  corStatus?: string;
  escala?: number;
}) {
  const anim = `agente-andar-${id}`;
  return (
    <>
      <style>{`
        @keyframes ${anim} {
          0%, 14% { transform: translate(${deskPe.x}px, ${deskPe.y}px); }
          40%, 60% { transform: translate(${comumPe.x}px, ${comumPe.y}px); }
          86%, 100% { transform: translate(${deskPe.x}px, ${deskPe.y}px); }
        }
      `}</style>
      <g style={{ animation: `${anim} 18s ease-in-out infinite` }}>
        <g transform={`scale(${escala})`}>
          <ellipse cx={0} cy={2} rx={17} ry={5} fill="rgba(0,0,0,0.3)" />
          <CorpoHumano cor={cor} corStatus={corStatus} />
        </g>
      </g>
    </>
  );
}

const COR_ADS = "#3b82c4";

function IlustracaoAgente({ alerta }: { alerta: boolean }) {
  const corStatus = alerta ? "var(--critical-text)" : "var(--good-text)";

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

  const pePersonagem = isoPoint(1.7, 3.6);

  return (
    <svg viewBox="0 0 300 220" className="agente-svg" role="img" aria-label="Sala do agente Analista de Ads">
      <polygon points={paredeEsquerda} fill={sombrear(COR_PAREDE, 0.65)} stroke={sombrear(COR_PAREDE, 0.4)} strokeWidth="1" />
      <polygon points={paredeDireita} fill={sombrear(COR_PAREDE, 0.9)} stroke={sombrear(COR_PAREDE, 0.4)} strokeWidth="1" />
      {tiles}
      <Estante />
      <MesaComMonitor alerta={alerta} />
      <Luminaria />
      <Mobilia x0={2.9} y0={1.5} x1={3.7} y1={2.1} altura={9} cor="#1c1f26" />
      <Mobilia x0={3.0} y0={1.95} x1={3.6} y1={2.1} altura={28} elevar={9} cor="#20232b" />
      <PersonagemHumano pe={pePersonagem} cor={COR_ADS} corStatus={corStatus} escala={0.65} />
    </svg>
  );
}

// Escritório grande e compartilhado (Modo TV) — mesma técnica isométrica da
// sala pequena, mas com sua própria projeção (grid maior, origem própria)
// pra caber 3 mesas: Analista de Ads, Agente de Imagens e uma vaga pra um
// futuro agente. Os dois personagens reais andam da mesa deles até uma área
// comum no meio da sala e voltam, num loop.
const GRID_G = 8;
const TILE_W_G = 26;
const TILE_H_G = 13;
const WALL_H_G = 85;
const ORIGEM_X_G = 210;
const ORIGEM_Y_G = 90;

function isoPointG(x: number, y: number): Ponto {
  return { x: ORIGEM_X_G + (x - y) * (TILE_W_G / 2), y: ORIGEM_Y_G + (x + y) * (TILE_H_G / 2) };
}

const COR_IMAGENS = "#a855c9";

// Mesa com monitor mostrando um gráfico (Ads) ou um ícone de foto (Imagens)
// — mesma estrutura da MesaComMonitor da sala pequena, só que deslocável no
// grid maior e com conteúdo de tela configurável.
function MesaGrande({
  x0,
  tipo,
  alerta,
}: {
  x0: number;
  tipo: "ads" | "imagens" | "vaga";
  alerta?: boolean;
}) {
  const mesa = caixaIso(x0, 0.3, x0 + 1.6, 1.0, 22, 0, "#2b2f3a", isoPointG);
  const monitor =
    tipo !== "vaga" ? caixaIso(x0 + 0.5, 0.42, x0 + 1.1, 0.6, 16, 22, "#14161d", isoPointG) : null;
  const telaConteudo = (() => {
    if (!monitor) return null;
    const { A, B, C, D } = monitor.faceEsquerda;
    if (tipo === "ads") {
      const valores = [0.15, 0.38, 0.3, 0.58, 0.48, 0.72, 0.9];
      const pontos = valores.map((v, i) => dentroDaFace(A, B, C, D, 0.12 + (i / (valores.length - 1)) * 0.76, 0.82 - v * 0.62));
      const linha = pontos.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
      const ponta = pontos[pontos.length - 1];
      const corLinha = alerta ? "var(--critical-text)" : "var(--good-text)";
      return (
        <>
          <polygon points={pontosStr([A, B, C, D])} fill="#0c2a22" />
          <polyline
            points={linha}
            fill="none"
            stroke={corLinha}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="agente-grafico-linha"
          />
          <circle cx={ponta.x} cy={ponta.y} r={1.9} fill={corLinha} className="agente-grafico-ponto" />
        </>
      );
    }
    // Agente de Imagens: um "ícone de foto" simples (retângulo + montanha +
    // sol) em vez de gráfico, já que o trabalho dele não é métrica.
    const centro = dentroDaFace(A, B, C, D, 0.5, 0.5);
    const canto1 = dentroDaFace(A, B, C, D, 0.2, 0.75);
    const canto2 = dentroDaFace(A, B, C, D, 0.5, 0.4);
    const canto3 = dentroDaFace(A, B, C, D, 0.8, 0.75);
    return (
      <>
        <polygon points={pontosStr([A, B, C, D])} fill="#1a1030" />
        <polygon points={pontosStr([canto1, canto2, canto3])} fill="#a855c9" opacity={0.8} />
        <circle cx={centro.x + 4} cy={centro.y - 5} r={2} fill="#f2e2b8" />
      </>
    );
  })();
  return (
    <g>
      {mesa.esquerda}
      {mesa.direita}
      {mesa.topo}
      {monitor && (
        <>
          {monitor.esquerda}
          {monitor.direita}
          {monitor.topo}
          {telaConteudo}
        </>
      )}
      {tipo === "vaga" && (
        <text
          x={isoPointG(x0 + 0.8, 0.65).x}
          y={isoPointG(x0 + 0.8, 0.65).y - 26}
          textAnchor="middle"
          fontSize="7"
          fill="var(--text-muted)"
        >
          Em breve
        </text>
      )}
    </g>
  );
}

function EscritorioCompartilhado({ alertaAds }: { alertaAds: boolean }) {
  const costas = isoPointG(0, 0);
  const cantoDireito = isoPointG(GRID_G, 0);
  const cantoEsquerdo = isoPointG(0, GRID_G);
  const paredeEsquerda = pontosStr([
    cantoEsquerdo,
    costas,
    { x: costas.x, y: costas.y - WALL_H_G },
    { x: cantoEsquerdo.x, y: cantoEsquerdo.y - WALL_H_G },
  ]);
  const paredeDireita = pontosStr([
    costas,
    cantoDireito,
    { x: cantoDireito.x, y: cantoDireito.y - WALL_H_G },
    { x: costas.x, y: costas.y - WALL_H_G },
  ]);

  const tiles = [];
  for (let gx = 0; gx < GRID_G; gx++) {
    for (let gy = 0; gy < GRID_G; gy++) {
      const p0 = isoPointG(gx, gy);
      const p1 = isoPointG(gx + 1, gy);
      const p2 = isoPointG(gx + 1, gy + 1);
      const p3 = isoPointG(gx, gy + 1);
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

  const bookshelfCaixa = caixaIso(0.2, 2.0, 0.9, 2.8, 58, 0, "#3a2e22", isoPointG);
  const bookshelfFace = bookshelfCaixa.faceEsquerda;
  const cores = ["#b0463c", "#3f66c4", "#e8b84b"];
  const livros = cores.map((cor, i) => {
    const p0 = dentroDaFace(bookshelfFace.A, bookshelfFace.B, bookshelfFace.C, bookshelfFace.D, 0.14 + i * 0.24, 0.5);
    const p1 = dentroDaFace(bookshelfFace.A, bookshelfFace.B, bookshelfFace.C, bookshelfFace.D, 0.3 + i * 0.24, 0.86);
    return (
      <rect
        key={cor}
        x={Math.min(p0.x, p1.x)}
        y={p0.y}
        width={Math.max(2, Math.abs(p1.x - p0.x))}
        height={Math.abs(p1.y - p0.y)}
        fill={cor}
      />
    );
  });
  const topoEstante = dentroDaFace(bookshelfFace.A, bookshelfFace.B, bookshelfFace.C, bookshelfFace.D, 0.5, 0);

  const lampadaBase = isoPointG(7.2, 3.8);
  const lampadaTopo = { x: lampadaBase.x, y: lampadaBase.y - 60 };

  const deskAds = isoPointG(1.6, 3.0);
  const deskImagens = isoPointG(4.6, 3.0);
  const comumAds = isoPointG(2.8, 5.8);
  const comumImagens = isoPointG(4.4, 5.8);

  return (
    <svg viewBox="0 0 420 260" className="agente-svg agente-svg-grande" role="img" aria-label="Escritório compartilhado dos agentes">
      <polygon points={paredeEsquerda} fill={sombrear(COR_PAREDE, 0.65)} stroke={sombrear(COR_PAREDE, 0.4)} strokeWidth="1" />
      <polygon points={paredeDireita} fill={sombrear(COR_PAREDE, 0.9)} stroke={sombrear(COR_PAREDE, 0.4)} strokeWidth="1" />
      {tiles}

      <g>
        {bookshelfCaixa.esquerda}
        {bookshelfCaixa.direita}
        {bookshelfCaixa.topo}
        {livros}
        <circle cx={topoEstante.x - 4} cy={topoEstante.y - 5} r={4.5} fill="#3f8f5c" />
        <circle cx={topoEstante.x + 3} cy={topoEstante.y - 7} r={3.5} fill="#4aa568" />
      </g>

      <MesaGrande x0={1.0} tipo="ads" alerta={alertaAds} />
      <MesaGrande x0={3.4} tipo="imagens" />
      <MesaGrande x0={5.8} tipo="vaga" />

      <g>
        <ellipse cx={lampadaBase.x} cy={lampadaBase.y} rx={5} ry={2.4} fill={sombrear("#5b4a35", 0.6)} />
        <line x1={lampadaBase.x} y1={lampadaBase.y} x2={lampadaTopo.x} y2={lampadaTopo.y} stroke="#5b4a35" strokeWidth="2" />
        <ellipse
          cx={lampadaTopo.x}
          cy={lampadaTopo.y - 6}
          rx={9}
          ry={5}
          fill="#f2e2b8"
          stroke={sombrear("#f2e2b8", 0.7)}
          strokeWidth="1"
        />
        <ellipse cx={lampadaTopo.x} cy={lampadaTopo.y - 3} rx={12} ry={9} fill="#fff4d6" opacity={0.3} className="agente-luz-brilho" />
      </g>

      <PersonagemAndante
        id="ads"
        deskPe={deskAds}
        comumPe={comumAds}
        cor={COR_ADS}
        corStatus={alertaAds ? "var(--critical-text)" : "var(--good-text)"}
        escala={0.6}
      />
      <PersonagemAndante id="imagens" deskPe={deskImagens} comumPe={comumImagens} cor={COR_IMAGENS} escala={0.6} />
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

function AnalistaAds() {
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
    <>
      <div className="financeiro-topo">
        <div>
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
    </>
  );
}

function TratarFoto() {
  const [original, setOriginal] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);
  const [erroImg, setErroImg] = useState<string | null>(null);

  function onArquivo(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setResultado(null);
    setErroImg(null);
    const leitor = new FileReader();
    leitor.onload = () => {
      const dataUrl = leitor.result as string;
      setOriginal(dataUrl);
      setBase64(dataUrl.split(",")[1] ?? null);
    };
    leitor.readAsDataURL(arquivo);
  }

  async function tratar() {
    if (!base64) return;
    setProcessando(true);
    setErroImg(null);
    try {
      setResultado(await tratarFotoProduto(base64));
    } catch (err) {
      setErroImg(err instanceof Error ? err.message : "Falha ao tratar a foto.");
    } finally {
      setProcessando(false);
    }
  }

  return (
    <div className="agente-imagens-painel">
      <p className="painel-sub">Envie a foto real do produto — a IA troca só o fundo, sem alterar o produto.</p>
      <input type="file" accept="image/*" onChange={onArquivo} />

      {erroImg && <div className="state-message state-error">{erroImg}</div>}

      {original && (
        <div className="agente-imagens-comparacao">
          <div className="agente-imagens-coluna">
            <span className="financeiro-td-mudo">Original</span>
            <img src={original} alt="Foto original do produto" className="agente-imagens-preview" />
          </div>
          <div className="agente-imagens-coluna">
            <span className="financeiro-td-mudo">Tratada</span>
            {resultado ? (
              <img
                src={`data:image/png;base64,${resultado}`}
                alt="Foto do produto com fundo tratado"
                className="agente-imagens-preview"
              />
            ) : (
              <div className="agente-imagens-vazio">{processando ? "Tratando..." : "Ainda não tratada"}</div>
            )}
          </div>
        </div>
      )}

      <div className="agente-imagens-acoes">
        <button type="button" className="btn-responder" onClick={tratar} disabled={!base64 || processando}>
          {processando ? "Tratando..." : "Tratar foto"}
        </button>
        {resultado && (
          <a className="btn-secundario" href={`data:image/png;base64,${resultado}`} download="foto-tratada.png">
            Baixar
          </a>
        )}
      </div>
    </div>
  );
}

function CriarArte() {
  const [descricao, setDescricao] = useState("");
  const [resultado, setResultado] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [erroArte, setErroArte] = useState<string | null>(null);

  async function gerar() {
    const texto = descricao.trim();
    if (!texto || gerando) return;
    setGerando(true);
    setErroArte(null);
    try {
      setResultado(await criarArtePromocional(texto));
    } catch (err) {
      setErroArte(err instanceof Error ? err.message : "Falha ao gerar a arte.");
    } finally {
      setGerando(false);
    }
  }

  return (
    <div className="agente-imagens-painel">
      <p className="painel-sub">Descreva a arte que você quer — a IA gera uma imagem nova do zero.</p>
      <textarea
        className="pergunta-textarea"
        rows={3}
        value={descricao}
        onChange={(e) => setDescricao(e.target.value)}
        placeholder="Ex: banner de promoção de tinta acrílica, 20% off, cores vermelho e branco, pra post no Instagram"
        disabled={gerando}
      />

      {erroArte && <div className="state-message state-error">{erroArte}</div>}

      <div className="agente-imagens-acoes">
        <button type="button" className="btn-responder" onClick={gerar} disabled={!descricao.trim() || gerando}>
          {gerando ? "Gerando..." : "Gerar arte"}
        </button>
        {resultado && (
          <a className="btn-secundario" href={`data:image/png;base64,${resultado}`} download="arte-promocional.png">
            Baixar
          </a>
        )}
      </div>

      {resultado && (
        <img
          src={`data:image/png;base64,${resultado}`}
          alt="Arte promocional gerada"
          className="agente-imagens-preview agente-imagens-preview-solo"
        />
      )}
    </div>
  );
}

const NOMES_SLIDES = ["Foto limpa (fundo branco)", "Capa", "Benefícios", "Especificações", "Onde aplicar"];

function KitFotos() {
  const [original, setOriginal] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [nomeProduto, setNomeProduto] = useState("");
  const [subtitulo, setSubtitulo] = useState("");
  const [cores, setCores] = useState("");
  const [beneficios, setBeneficios] = useState("");
  const [especificacaoPrincipal, setEspecificacaoPrincipal] = useState("");
  const [specsSecundarias, setSpecsSecundarias] = useState("");
  const [ondeAplicar, setOndeAplicar] = useState("");
  const [resultados, setResultados] = useState<string[] | null>(null);
  const [gerando, setGerando] = useState(false);
  const [erroKit, setErroKit] = useState<string | null>(null);

  function onArquivo(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setResultados(null);
    setErroKit(null);
    const leitor = new FileReader();
    leitor.onload = () => {
      const dataUrl = leitor.result as string;
      setOriginal(dataUrl);
      setBase64(dataUrl.split(",")[1] ?? null);
    };
    leitor.readAsDataURL(arquivo);
  }

  function paraLinhas(texto: string): string[] {
    return texto
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  async function gerar() {
    if (!base64 || !nomeProduto.trim() || gerando) return;
    setGerando(true);
    setErroKit(null);
    setResultados(null);
    try {
      const imagens = await gerarKitFotos(base64, {
        nomeProduto: nomeProduto.trim(),
        subtitulo: subtitulo.trim(),
        cores: cores.trim(),
        beneficios: paraLinhas(beneficios),
        especificacaoPrincipal: especificacaoPrincipal.trim(),
        specsSecundarias: paraLinhas(specsSecundarias),
        ondeAplicar: paraLinhas(ondeAplicar),
      });
      setResultados(imagens);
    } catch (err) {
      setErroKit(err instanceof Error ? err.message : "Falha ao gerar o kit.");
    } finally {
      setGerando(false);
    }
  }

  return (
    <div className="agente-imagens-painel">
      <p className="painel-sub">
        Sobe a foto real do produto, preenche as informações abaixo e a IA gera 5 imagens pro anúncio: foto tratada,
        capa, benefícios, especificações e onde aplicar. Confira o texto de cada uma antes de usar — a IA pode errar
        ortografia.
      </p>

      <input type="file" accept="image/*" onChange={onArquivo} />
      {original && <img src={original} alt="Foto original do produto" className="agente-imagens-preview" />}

      <label className="agente-imagens-campo">
        Nome do produto
        <input
          type="text"
          className="pergunta-textarea"
          value={nomeProduto}
          onChange={(e) => setNomeProduto(e.target.value)}
          placeholder="Ex: Resiflex Manta Líquida Emborrachada 18kg"
        />
      </label>

      <label className="agente-imagens-campo">
        Subtítulo / uso principal
        <input
          type="text"
          className="pergunta-textarea"
          value={subtitulo}
          onChange={(e) => setSubtitulo(e.target.value)}
          placeholder="Ex: Proteção e impermeabilização para telhados e lajes"
        />
      </label>

      <label className="agente-imagens-campo">
        Cores da marca (opcional)
        <input
          type="text"
          className="pergunta-textarea"
          value={cores}
          onChange={(e) => setCores(e.target.value)}
          placeholder="Ex: preto e amarelo, como no rótulo do produto"
        />
      </label>

      <label className="agente-imagens-campo">
        Benefícios (um por linha)
        <textarea
          className="pergunta-textarea"
          rows={3}
          value={beneficios}
          onChange={(e) => setBeneficios(e.target.value)}
          placeholder={"Impermeável\nResistente a sol e chuva\nFácil aplicação\nSecagem rápida"}
        />
      </label>

      <label className="agente-imagens-campo">
        Especificação principal (número grande em destaque)
        <input
          type="text"
          className="pergunta-textarea"
          value={especificacaoPrincipal}
          onChange={(e) => setEspecificacaoPrincipal(e.target.value)}
          placeholder="Ex: Rende até 150m²"
        />
      </label>

      <label className="agente-imagens-campo">
        Especificações menores (uma por linha)
        <textarea
          className="pergunta-textarea"
          rows={3}
          value={specsSecundarias}
          onChange={(e) => setSpecsSecundarias(e.target.value)}
          placeholder={"Ao toque: 2h\nEntre demãos: 4h\nLiberação: 12-24h"}
        />
      </label>

      <label className="agente-imagens-campo">
        Onde aplicar (um por linha)
        <textarea
          className="pergunta-textarea"
          rows={3}
          value={ondeAplicar}
          onChange={(e) => setOndeAplicar(e.target.value)}
          placeholder={"Telhados\nParedes\nLajes\nConcreto"}
        />
      </label>

      {erroKit && <div className="state-message state-error">{erroKit}</div>}

      <div className="agente-imagens-acoes">
        <button type="button" className="btn-responder" onClick={gerar} disabled={!base64 || !nomeProduto.trim() || gerando}>
          {gerando ? "Gerando kit (pode levar um tempinho)..." : "Gerar kit de fotos"}
        </button>
      </div>

      {resultados && (
        <div className="agente-kit-grade">
          {resultados.map((img, i) => (
            <div key={i} className="agente-imagens-coluna">
              <span className="financeiro-td-mudo">{NOMES_SLIDES[i] ?? `Slide ${i + 1}`}</span>
              <img src={`data:image/png;base64,${img}`} alt={NOMES_SLIDES[i] ?? `Slide ${i + 1}`} className="agente-imagens-preview" />
              <a
                className="btn-secundario"
                href={`data:image/png;base64,${img}`}
                download={`kit-${i + 1}-${(NOMES_SLIDES[i] ?? "slide").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`}
              >
                Baixar
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AgenteImagens() {
  const [modo, setModo] = useState<"tratar" | "arte" | "kit">("tratar");

  return (
    <>
      <div className="financeiro-topo">
        <div>
          <h1>Agente de Imagens</h1>
          <p className="painel-sub">
            Trata fotos reais de produto (fundo limpo, sem alterar o produto) ou cria artes promocionais do zero a
            partir de uma descrição. Sempre confira o resultado antes de usar num anúncio ou postagem — a IA pode
            alterar pequenos detalhes.
          </p>
        </div>
      </div>

      <div className="agente-tabs agente-tabs-secundaria">
        <button
          type="button"
          className={`agente-tab ${modo === "tratar" ? "agente-tab-ativa" : ""}`}
          onClick={() => setModo("tratar")}
        >
          Tratar foto de produto
        </button>
        <button
          type="button"
          className={`agente-tab ${modo === "arte" ? "agente-tab-ativa" : ""}`}
          onClick={() => setModo("arte")}
        >
          Criar arte promocional
        </button>
        <button
          type="button"
          className={`agente-tab ${modo === "kit" ? "agente-tab-ativa" : ""}`}
          onClick={() => setModo("kit")}
        >
          Kit de fotos p/ anúncio
        </button>
      </div>

      {modo === "tratar" && <TratarFoto />}
      {modo === "arte" && <CriarArte />}
      {modo === "kit" && <KitFotos />}
    </>
  );
}

// Modo TV do escritório compartilhado — busca o feed do Analista de Ads por
// conta própria (não depende de qual aba está ativa), atualiza sozinho a
// cada 1 min e sai com Esc. O Agente de Imagens não tem "pendência" pra
// carregar, então só o Ads alimenta o crachá de status do personagem dele.
function ModoTVEscritorio({ onSair }: { onSair: () => void }) {
  const [pendentes, setPendentes] = useState(0);
  const [pensamentos, setPensamentos] = useState<PensamentoAds[] | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [feedNovo, pensamentosNovos] = await Promise.all([fetchFeedAds("pendente"), fetchPensamentosAds()]);
      setPendentes(feedNovo.length);
      setPensamentos(pensamentosNovos);
    } catch {
      // Modo TV não mostra erro — só mantém o último estado conhecido na tela.
    }
  }, []);

  useEffect(() => {
    carregar();
    const intervalo = setInterval(carregar, 60000);
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSair();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => {
      clearInterval(intervalo);
      window.removeEventListener("keydown", aoTeclar);
    };
  }, [carregar, onSair]);

  return (
    <div className="agente-tv-overlay">
      <button type="button" className="agente-tv-sair" onClick={onSair}>
        Sair (Esc)
      </button>
      <EscritorioCompartilhado alertaAds={pendentes > 0} />
      <div className="agente-tv-status">
        {pensamentos && pensamentos.length > 0 ? (
          <p className="agente-tv-pensamento">{pensamentos[0].pensamento}</p>
        ) : (
          <span className="financeiro-td-mudo">Analista de Ads ainda sem nenhuma verificação registrada.</span>
        )}
        {pendentes === 0 ? (
          <span className="financeiro-margem-positiva">Ads: tudo certo — nenhuma pendência.</span>
        ) : (
          <span className="financeiro-margem-negativa">
            Ads: {pendentes} observaç{pendentes !== 1 ? "ões" : "ão"} pendente{pendentes !== 1 ? "s" : ""}.
          </span>
        )}
      </div>
    </div>
  );
}

export function AgenciaAgentesIA() {
  const [agente, setAgente] = useState<"ads" | "imagens">("ads");
  const [modoTV, setModoTV] = useState(false);

  return (
    <div className="financeiro-page">
      <div className="agente-topo-hub">
        <span className="painel-eyebrow">Agência de Agentes IA</span>
        <button type="button" className="btn-secundario" onClick={() => setModoTV(true)}>
          Modo TV
        </button>
      </div>

      <div className="agente-tabs">
        <button
          type="button"
          className={`agente-tab ${agente === "ads" ? "agente-tab-ativa" : ""}`}
          onClick={() => setAgente("ads")}
        >
          Analista de Ads
        </button>
        <button
          type="button"
          className={`agente-tab ${agente === "imagens" ? "agente-tab-ativa" : ""}`}
          onClick={() => setAgente("imagens")}
        >
          Agente de Imagens
        </button>
      </div>

      {agente === "ads" ? <AnalistaAds /> : <AgenteImagens />}

      {modoTV && <ModoTVEscritorio onSair={() => setModoTV(false)} />}
    </div>
  );
}
