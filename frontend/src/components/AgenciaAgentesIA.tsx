import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import {
  fetchPensamentosAds,
  perguntarAgenteAds,
  tratarFotoProduto,
  criarArtePromocional,
  gerarKitFotos,
  fetchPerfisImagens,
  criarPerfilImagens,
  excluirPerfilImagens,
  buscarDadosAnuncio,
  fetchReferenciasPerfil,
  favoritarReferenciaPerfil,
  fetchOportunidades,
  verificarOportunidadesAgora,
  fetchPensamentosCatalogo,
  fetchPensamentosConversao,
  fetchPlanoDiario,
  verificarPlanoDiarioAgora,
  marcarItemPlano,
  fetchResumoEscritorio,
  type SugestaoOriginalKit,
} from "../api/agentes";
import type {
  PensamentoAds,
  MensagemChat,
  PerfilImagens,
  Oportunidade,
  PensamentoCatalogo,
  PensamentoConversao,
  PlanoDiario,
  ResumoEscritorio,
} from "../types/agentes";
import { formatDataHora, formatCurrency } from "../utils/format";

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
  const pontosGrafico = valores.map((v, i) => dentroDaFace(A, B, C, D, 0.12 + (i / (valores.length - 1)) * 0.76, 0.18 + v * 0.62));
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
  nome,
  deskPe,
  comumPe,
  cor,
  corStatus,
  escala = 1,
  atrasoS = 0,
}: {
  id: string;
  nome: string;
  deskPe: Ponto;
  comumPe: Ponto;
  cor: string;
  corStatus?: string;
  escala?: number;
  atrasoS?: number;
}) {
  const anim = `agente-andar-${id}`;
  // Nome fica fora do <g scale(escala)> do corpo, senão a fonte encolheria
  // junto (personagens pequenos ficariam com texto ilegível) — só a altura
  // (topo da cabeça é y=-71 no corpo sem escala) acompanha a escala do corpo.
  const alturaNome = -71 * escala - 6;
  return (
    <>
      <style>{`
        @keyframes ${anim} {
          0%, 14% { transform: translate(${deskPe.x}px, ${deskPe.y}px); }
          40%, 60% { transform: translate(${comumPe.x}px, ${comumPe.y}px); }
          86%, 100% { transform: translate(${deskPe.x}px, ${deskPe.y}px); }
        }
      `}</style>
      {/* atraso negativo defasa os 3 personagens entre si — sem isso os 3
          chegam na área comum ao mesmo tempo e as etiquetas de nome se
          amontoam; com fases diferentes, o encontro vira exceção rápida
          em vez de regra constante. */}
      <g style={{ animation: `${anim} 18s ease-in-out infinite`, animationDelay: `${atrasoS}s` }}>
        <g transform={`scale(${escala})`}>
          <ellipse cx={0} cy={2} rx={17} ry={5} fill="rgba(0,0,0,0.3)" />
          <CorpoHumano cor={cor} corStatus={corStatus} />
        </g>
        <NomePersonagem nome={nome} y={alturaNome} />
      </g>
    </>
  );
}

// Etiqueta com o nome do agente + bolinha verde de "online", flutuando acima
// da cabeça. Contorno escuro no texto (em vez de uma placa de fundo) pra
// continuar legível em qualquer parte do piso/parede, sem virar um bloco
// sólido grande demais pra essas mesas próximas umas das outras.
function NomePersonagem({ nome, y }: { nome: string; y: number }) {
  const larguraAprox = nome.length * 1.9;
  return (
    <g transform={`translate(0, ${y})`}>
      <text
        textAnchor="middle"
        fontSize="6.5"
        fontWeight={700}
        fill="#fff"
        stroke="rgba(10,12,18,0.75)"
        strokeWidth={2.2}
        paintOrder="stroke"
      >
        {nome}
      </text>
      <circle cx={larguraAprox + 5} cy={-2} r={2} fill="#3fbf6f" stroke="#0e2e1c" strokeWidth={0.6} />
    </g>
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
// pra caber as 5 mesas: Analista de Ads, Agente de Imagens, Agente de
// Oportunidades, Agente de Catálogo e Agente de Conversão. Os personagens
// andam da mesa deles até uma área comum no meio da sala e voltam, num
// loop. Largura (X) maior que profundidade (Y) de propósito — a fileira de
// mesas cresce pro lado conforme entram agentes novos, sem precisar deixar
// a sala mais funda (que ficaria vazia demais no fundo).
const GRID_X_G = 13;
const GRID_Y_G = 8;
const TILE_W_G = 26;
const TILE_H_G = 13;
const WALL_H_G = 85;
const ORIGEM_X_G = 208;
const ORIGEM_Y_G = 90;

function isoPointG(x: number, y: number): Ponto {
  return { x: ORIGEM_X_G + (x - y) * (TILE_W_G / 2), y: ORIGEM_Y_G + (x + y) * (TILE_H_G / 2) };
}

const COR_IMAGENS = "#a855c9";
const COR_OPORTUNIDADES = "#d9a33e";
const COR_CATALOGO = "#2dd4bf";
const COR_CONVERSAO = "#f97316";

// Mesa com monitor mostrando um gráfico (Ads) ou um ícone de foto (Imagens)
// — mesma estrutura da MesaComMonitor da sala pequena, só que deslocável no
// grid maior e com conteúdo de tela configurável.
function MesaGrande({
  x0,
  tipo,
  alerta,
}: {
  x0: number;
  tipo: "ads" | "imagens" | "oportunidades" | "catalogo" | "conversao" | "vaga";
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
      const pontos = valores.map((v, i) => dentroDaFace(A, B, C, D, 0.12 + (i / (valores.length - 1)) * 0.76, 0.18 + v * 0.62));
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
    if (tipo === "oportunidades") {
      // Ícone de tendência subindo — o trabalho desse agente é apontar SKU
      // "em alta" no grupo, então a tela mostra uma linha crescente em vez
      // do gráfico de ACOS (Ads) ou do ícone de foto (Imagens).
      const pontos = [
        dentroDaFace(A, B, C, D, 0.14, 0.2),
        dentroDaFace(A, B, C, D, 0.42, 0.4),
        dentroDaFace(A, B, C, D, 0.66, 0.32),
        dentroDaFace(A, B, C, D, 0.9, 0.78),
      ];
      const linha = pontos.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
      const ponta = pontos[pontos.length - 1];
      return (
        <>
          <polygon points={pontosStr([A, B, C, D])} fill="#2a2410" />
          <polyline
            points={linha}
            fill="none"
            stroke={COR_OPORTUNIDADES}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="agente-grafico-linha"
          />
          <circle cx={ponta.x} cy={ponta.y} r={1.9} fill={COR_OPORTUNIDADES} className="agente-grafico-ponto" />
        </>
      );
    }
    if (tipo === "catalogo") {
      // Ícone de etiqueta de preço (pentágono + furo) — o trabalho desse
      // agente é sobre preço/margem de catálogo, não uma métrica ao longo
      // do tempo, então não faz sentido um gráfico de linha aqui.
      const etiqueta = pontosStr([
        dentroDaFace(A, B, C, D, 0.2, 0.28),
        dentroDaFace(A, B, C, D, 0.62, 0.28),
        dentroDaFace(A, B, C, D, 0.86, 0.5),
        dentroDaFace(A, B, C, D, 0.62, 0.72),
        dentroDaFace(A, B, C, D, 0.2, 0.72),
      ]);
      const furo = dentroDaFace(A, B, C, D, 0.34, 0.5);
      return (
        <>
          <polygon points={pontosStr([A, B, C, D])} fill="#0f2e2a" />
          <polygon points={etiqueta} fill={COR_CATALOGO} opacity={0.85} />
          <circle cx={furo.x} cy={furo.y} r={1.6} fill="#0f2e2a" />
        </>
      );
    }
    if (tipo === "conversao") {
      // Ícone de funil (largo em cima, estreito embaixo) — visitas entrando
      // largo, vendas saindo estreito, a metáfora visual da conversão.
      const funil = pontosStr([
        dentroDaFace(A, B, C, D, 0.16, 0.22),
        dentroDaFace(A, B, C, D, 0.84, 0.22),
        dentroDaFace(A, B, C, D, 0.6, 0.58),
        dentroDaFace(A, B, C, D, 0.6, 0.78),
        dentroDaFace(A, B, C, D, 0.4, 0.78),
        dentroDaFace(A, B, C, D, 0.4, 0.58),
      ]);
      return (
        <>
          <polygon points={pontosStr([A, B, C, D])} fill="#3a1f08" />
          <polygon points={funil} fill={COR_CONVERSAO} opacity={0.85} />
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
  const cantoDireito = isoPointG(GRID_X_G, 0);
  const cantoEsquerdo = isoPointG(0, GRID_Y_G);
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
  for (let gx = 0; gx < GRID_X_G; gx++) {
    for (let gy = 0; gy < GRID_Y_G; gy++) {
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

  // Duas luminárias em vez de uma só — a sala ficou larga demais (5 mesas)
  // pra uma lâmpada central iluminar de ponta a ponta sem parecer esquisito.
  const luminarias = [isoPointG(3.6, 6.4), isoPointG(9.6, 6.4)].map((base) => ({
    base,
    topo: { x: base.x, y: base.y - 60 },
  }));

  const deskAds = isoPointG(1.6, 3.0);
  const deskImagens = isoPointG(4.6, 3.0);
  const deskOportunidades = isoPointG(6.6, 3.0);
  const deskCatalogo = isoPointG(8.8, 3.0);
  const deskConversao = isoPointG(11.2, 3.0);
  const comumAds = isoPointG(2.2, 5.8);
  const comumImagens = isoPointG(4.4, 5.8);
  const comumOportunidades = isoPointG(6.6, 5.8);
  const comumCatalogo = isoPointG(8.8, 5.6);
  const comumConversao = isoPointG(11.0, 5.9);

  return (
    <svg viewBox="0 0 500 260" className="agente-svg agente-svg-grande" role="img" aria-label="Escritório compartilhado dos agentes">
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
      <MesaGrande x0={5.8} tipo="oportunidades" />
      <MesaGrande x0={8.2} tipo="catalogo" />
      <MesaGrande x0={10.6} tipo="conversao" />

      {luminarias.map((l, i) => (
        <g key={i}>
          <ellipse cx={l.base.x} cy={l.base.y} rx={5} ry={2.4} fill={sombrear("#5b4a35", 0.6)} />
          <line x1={l.base.x} y1={l.base.y} x2={l.topo.x} y2={l.topo.y} stroke="#5b4a35" strokeWidth="2" />
          <ellipse cx={l.topo.x} cy={l.topo.y - 6} rx={9} ry={5} fill="#f2e2b8" stroke={sombrear("#f2e2b8", 0.7)} strokeWidth="1" />
          <ellipse cx={l.topo.x} cy={l.topo.y - 3} rx={12} ry={9} fill="#fff4d6" opacity={0.3} className="agente-luz-brilho" />
        </g>
      ))}

      <PersonagemAndante
        id="ads"
        nome="Analista de Ads"
        deskPe={deskAds}
        comumPe={comumAds}
        cor={COR_ADS}
        corStatus={alertaAds ? "var(--critical-text)" : "var(--good-text)"}
        escala={0.6}
        atrasoS={0}
      />
      <PersonagemAndante
        id="imagens"
        nome="Designer"
        deskPe={deskImagens}
        comumPe={comumImagens}
        cor={COR_IMAGENS}
        escala={0.6}
        atrasoS={-3.6}
      />
      <PersonagemAndante
        id="oportunidades"
        nome="Gestão de Oportunidades"
        deskPe={deskOportunidades}
        comumPe={comumOportunidades}
        cor={COR_OPORTUNIDADES}
        escala={0.6}
        atrasoS={-7.2}
      />
      <PersonagemAndante
        id="catalogo"
        nome="Analista de Catálogo"
        deskPe={deskCatalogo}
        comumPe={comumCatalogo}
        cor={COR_CATALOGO}
        escala={0.6}
        atrasoS={-10.8}
      />
      <PersonagemAndante
        id="conversao"
        nome="Analista de Funil"
        deskPe={deskConversao}
        comumPe={comumConversao}
        cor={COR_CONVERSAO}
        escala={0.6}
        atrasoS={-14.4}
      />
    </svg>
  );
}

// Raciocínio real da IA (não é texto inventado pra decoração — é a análise
// que a própria Claude escreve, ver backend/src/services/agenteAdsService.ts).
// Um card por rodada de verificação, texto corrido preservando as quebras de
// linha originais — formato único do feed (sem cards por campanha).
function PensamentoCard({
  pensamento,
}: {
  pensamento: { pensamento: string; criadoEm: string; janela?: string; lojaNome?: string | null };
}) {
  const [expandido, setExpandido] = useState(false);
  return (
    <div className="agente-pensamento-card">
      <div className="agente-card-topo">
        <div className="agente-card-tags">
          {pensamento.lojaNome && <span className="agente-card-janela">{pensamento.lojaNome}</span>}
          {pensamento.janela !== undefined && (
            <span className="agente-card-janela">{pensamento.janela === "hoje" ? "Hoje" : "7 dias"}</span>
          )}
        </div>
        <span className="financeiro-td-mudo">{formatDataHora(pensamento.criadoEm)}</span>
      </div>
      <p className={`agente-pensamento-texto ${expandido ? "agente-pensamento-expandido" : ""}`}>
        {pensamento.pensamento}
      </p>
      <button type="button" className="agente-pensamento-toggle" onClick={() => setExpandido((v) => !v)}>
        {expandido ? "Mostrar menos" : "Ler tudo"}
      </button>
    </div>
  );
}

// Igual a MensagemChat, mas com o raciocínio (thinking) da IA guardado à
// parte — só pra exibição local, não é reenviado como histórico (o backend
// só precisa de papel+texto pra reconstruir a conversa).
interface MensagemExibida extends MensagemChat {
  pensamento?: string | null;
}

// Pergunta livre pro agente — mantém o histórico só na memória da página
// (não persiste como o feed/pensamentos), a cada pergunta ele busca os
// dados atuais das campanhas de novo no backend, então a resposta nunca
// fica desatualizada. Modelo mais forte (Opus) + raciocínio real exibido —
// pedido explícito do dono: "eu pensando e falando, ele pensando e falando".
function ChatAgente() {
  const [mensagens, setMensagens] = useState<MensagemExibida[]>([]);
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroChat, setErroChat] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const pergunta = input.trim();
    if (!pergunta || enviando) return;

    // Historico enviado ao backend não carrega o campo "pensamento" — a API
    // só espera papel/texto pra reconstruir a conversa.
    const historico: MensagemChat[] = mensagens.map(({ papel, texto }) => ({ papel, texto }));
    setMensagens((m) => [...m, { papel: "usuario", texto: pergunta }]);
    setInput("");
    setErroChat(null);
    setEnviando(true);
    try {
      const { resposta, pensamento } = await perguntarAgenteAds(pergunta, historico);
      setMensagens((m) => [...m, { papel: "agente", texto: resposta, pensamento }]);
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
          Pergunte algo sobre suas campanhas de Ads, ou peça um plano de ação — ele decide e recomenda com os dados
          atuais das suas 4 lojas, mostrando o raciocínio antes da resposta.
        </div>
      )}

      {mensagens.length > 0 && (
        <div className="agente-chat-mensagens">
          {mensagens.map((m, i) => (
            <div key={i} className={`agente-chat-msg agente-chat-msg-${m.papel}`}>
              {m.pensamento && (
                <details className="agente-chat-pensamento">
                  <summary>🧠 Pensando…</summary>
                  <p>{m.pensamento}</p>
                </details>
              )}
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

// Agente novo e separado do Analista de Ads: não observa nem registra feed
// sozinho, é 100% conversa sob demanda — o consultor mais forte (Opus +
// raciocínio visível), pra quando o dono quer discutir/decidir, não só ler
// um resumo automático.
function GrowthHacker() {
  return (
    <>
      <div className="financeiro-topo">
        <div>
          <h1>Growth Hacker</h1>
          <p className="painel-sub">
            Seu consultor de Ads mais forte — conversa em tempo real sobre as campanhas das suas 4 lojas, pensa antes
            de responder, e entrega decisão de verdade (pausar campanha, subir orçamento, mudar meta de ACOS), não só
            descreve os números.
          </p>
        </div>
      </div>

      <ChatAgente />
    </>
  );
}

function AnalistaAds() {
  const [pensamentos, setPensamentos] = useState<PensamentoAds[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lojaFiltro, setLojaFiltro] = useState<number | "todas">("todas");

  const carregar = useCallback(async () => {
    try {
      setPensamentos(await fetchPensamentosAds());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao carregar o feed.");
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Lojas dos próprios pensamentos já carregados — sem precisar de outra
  // chamada só pra popular o filtro (o agente só cobre as 4 lojas pessoais).
  const lojasDisponiveis = new Map<number, string>();
  for (const p of pensamentos ?? []) if (p.lojaId !== null && p.lojaNome !== null) lojasDisponiveis.set(p.lojaId, p.lojaNome);

  const pensamentosDaLoja =
    lojaFiltro === "todas" ? pensamentos : pensamentos?.filter((p) => p.lojaId === lojaFiltro) ?? null;

  return (
    <>
      <div className="financeiro-topo">
        <div>
          <h1>Analista de Ads</h1>
          <p className="painel-sub">
            Observa suas campanhas de Ads sozinho e comenta aqui o que encontra — ACOS fora da meta, campanha no
            prejuízo, orçamento parado. Escreve a análise em texto corrido, comparando as campanhas de uma vez.
          </p>
        </div>
        <div className="financeiro-filtros">
          <select
            className="dashboard-select"
            value={lojaFiltro}
            onChange={(e) => setLojaFiltro(e.target.value === "todas" ? "todas" : Number(e.target.value))}
          >
            <option value="todas">Todas as lojas</option>
            {[...lojasDisponiveis.entries()].map(([id, nome]) => (
              <option key={id} value={id}>
                {nome}
              </option>
            ))}
          </select>
        </div>
      </div>

      {erro && <div className="state-message state-error">{erro}</div>}

      <div className="agente-mesa">
        <IlustracaoAgente alerta={false} />
        <div className="agente-status">
          {pensamentos === null ? (
            <span className="financeiro-td-mudo">Carregando...</span>
          ) : pensamentosDaLoja && pensamentosDaLoja.length > 0 ? (
            <p className="agente-status-pensamento">{pensamentosDaLoja[0].pensamento}</p>
          ) : (
            <span className="financeiro-td-mudo">Ainda sem nenhuma verificação registrada.</span>
          )}
        </div>
      </div>

      <div className="agente-feed">
        <div className="agente-feed-topo">
          <span className="painel-eyebrow">O que ele está pensando</span>
        </div>

        {pensamentosDaLoja !== null && pensamentosDaLoja.length === 0 && (
          <div className="state-message">Nenhuma verificação registrada ainda.</div>
        )}

        {pensamentosDaLoja?.map((p) => <PensamentoCard key={p.id} pensamento={p} />)}
      </div>
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
  const [perfis, setPerfis] = useState<PerfilImagens[]>([]);
  const [perfilSelecionado, setPerfilSelecionado] = useState<number | "">("");
  const [referenciasGaleria, setReferenciasGaleria] = useState<string[]>([]);
  const [favoritando, setFavoritando] = useState(false);

  useEffect(() => {
    fetchPerfisImagens()
      .then(setPerfis)
      .catch(() => {
        // Silencioso — perfis são só uma conveniência.
      });
  }, []);

  async function selecionarPerfil(id: number | "") {
    setPerfilSelecionado(id);
    setReferenciasGaleria([]);
    if (id === "") return;
    try {
      setReferenciasGaleria(await fetchReferenciasPerfil(id));
    } catch {
      // Silencioso.
    }
  }

  async function gerar() {
    const texto = descricao.trim();
    if (!texto || gerando) return;
    setGerando(true);
    setErroArte(null);
    try {
      setResultado(await criarArtePromocional(texto, referenciasGaleria.length > 0 ? referenciasGaleria : undefined));
    } catch (err) {
      setErroArte(err instanceof Error ? err.message : "Falha ao gerar a arte.");
    } finally {
      setGerando(false);
    }
  }

  async function favoritar() {
    if (perfilSelecionado === "" || !resultado) return;
    setFavoritando(true);
    try {
      await favoritarReferenciaPerfil(perfilSelecionado, resultado);
      setReferenciasGaleria(await fetchReferenciasPerfil(perfilSelecionado));
    } catch (err) {
      setErroArte(err instanceof Error ? err.message : "Falha ao favoritar.");
    } finally {
      setFavoritando(false);
    }
  }

  return (
    <div className="agente-imagens-painel">
      <p className="painel-sub">
        Descreva a arte que você quer — a IA gera uma imagem nova do zero. Escolhendo um perfil de marca com
        referências favoritadas, ela usa artes anteriores como exemplo de estilo em vez de só a descrição em texto.
      </p>

      {perfis.length > 0 && (
        <label className="agente-imagens-campo">
          Perfil de marca (opcional) — usa a galeria de referências favoritadas dele
          <select
            className="pergunta-textarea"
            value={perfilSelecionado}
            onChange={(e) => selecionarPerfil(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">Nenhum</option>
            {perfis.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
      )}

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
        {resultado && perfilSelecionado !== "" && (
          <button type="button" className="btn-secundario" onClick={favoritar} disabled={favoritando}>
            {favoritando ? "Favoritando..." : "☆ Favoritar como referência"}
          </button>
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
  const [referenciaOriginal, setReferenciaOriginal] = useState<string | null>(null);
  const [referenciaBase64, setReferenciaBase64] = useState<string | null>(null);
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
  const [urlAnuncio, setUrlAnuncio] = useState("");
  const [buscandoAnuncio, setBuscandoAnuncio] = useState(false);
  const [erroAnuncio, setErroAnuncio] = useState<string | null>(null);
  const [sugestaoOriginal, setSugestaoOriginal] = useState<SugestaoOriginalKit | null>(null);
  const [perfis, setPerfis] = useState<PerfilImagens[]>([]);
  const [perfilSelecionado, setPerfilSelecionado] = useState<number | "">("");
  const [nomeNovoPerfil, setNomeNovoPerfil] = useState("");
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [referenciasGaleria, setReferenciasGaleria] = useState<string[]>([]);
  const [favoritando, setFavoritando] = useState<number | null>(null);

  const carregarPerfis = useCallback(async () => {
    try {
      setPerfis(await fetchPerfisImagens());
    } catch {
      // Silencioso — perfis são só uma conveniência, não impede o resto de funcionar.
    }
  }, []);

  useEffect(() => {
    carregarPerfis();
  }, [carregarPerfis]);

  async function aplicarPerfil(id: number | "") {
    setPerfilSelecionado(id);
    setReferenciasGaleria([]);
    if (id === "") return;
    const perfil = perfis.find((p) => p.id === id);
    if (!perfil) return;
    setCores(perfil.cores);
    setBeneficios(perfil.beneficiosPadrao);
    setOndeAplicar(perfil.ondeAplicarPadrao);
    if (perfil.imagemReferenciaBase64) {
      setReferenciaBase64(perfil.imagemReferenciaBase64);
      setReferenciaOriginal(`data:image/png;base64,${perfil.imagemReferenciaBase64}`);
    }
    try {
      setReferenciasGaleria(await fetchReferenciasPerfil(id));
    } catch {
      // Silencioso — galeria é só um bônus, não impede gerar com o resto do perfil.
    }
  }

  async function favoritar(index: number) {
    if (perfilSelecionado === "" || !resultados) return;
    setFavoritando(index);
    try {
      await favoritarReferenciaPerfil(perfilSelecionado, resultados[index]);
      setReferenciasGaleria(await fetchReferenciasPerfil(perfilSelecionado));
    } catch (err) {
      setErroKit(err instanceof Error ? err.message : "Falha ao favoritar.");
    } finally {
      setFavoritando(null);
    }
  }

  async function salvarPerfilAtual() {
    if (!nomeNovoPerfil.trim() || salvandoPerfil) return;
    setSalvandoPerfil(true);
    try {
      await criarPerfilImagens({
        nome: nomeNovoPerfil.trim(),
        cores,
        imagemReferenciaBase64: referenciaBase64,
        beneficiosPadrao: beneficios,
        ondeAplicarPadrao: ondeAplicar,
      });
      setNomeNovoPerfil("");
      await carregarPerfis();
    } catch (err) {
      setErroKit(err instanceof Error ? err.message : "Falha ao salvar perfil.");
    } finally {
      setSalvandoPerfil(false);
    }
  }

  async function removerPerfil(id: number) {
    try {
      await excluirPerfilImagens(id);
      if (perfilSelecionado === id) setPerfilSelecionado("");
      await carregarPerfis();
    } catch (err) {
      setErroKit(err instanceof Error ? err.message : "Falha ao excluir perfil.");
    }
  }

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

  function onArquivoReferencia(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    const leitor = new FileReader();
    leitor.onload = () => {
      const dataUrl = leitor.result as string;
      setReferenciaOriginal(dataUrl);
      setReferenciaBase64(dataUrl.split(",")[1] ?? null);
    };
    leitor.readAsDataURL(arquivo);
  }

  function paraLinhas(texto: string): string[] {
    return texto
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  async function buscarDoAnuncio() {
    if (!urlAnuncio.trim() || buscandoAnuncio) return;
    setBuscandoAnuncio(true);
    setErroAnuncio(null);
    try {
      const dados = await buscarDadosAnuncio(urlAnuncio.trim());
      setNomeProduto(dados.titulo);
      if (dados.subtitulo) setSubtitulo(dados.subtitulo);
      if (dados.beneficios.length > 0) setBeneficios(dados.beneficios.join("\n"));
      if (dados.especificacaoPrincipal) setEspecificacaoPrincipal(dados.especificacaoPrincipal);
      if (dados.specsSecundarias.length > 0) setSpecsSecundarias(dados.specsSecundarias.join("\n"));
      if (dados.ondeAplicar.length > 0) setOndeAplicar(dados.ondeAplicar.join("\n"));
      if (dados.fotoBase64) {
        setBase64(dados.fotoBase64);
        setOriginal(`data:image/jpeg;base64,${dados.fotoBase64}`);
      }
      // Guarda o que a IA sugeriu de início — se você editar antes de gerar,
      // essa diferença vira "memória" pra próxima sugestão ficar mais precisa.
      setSugestaoOriginal({
        subtitulo: dados.subtitulo,
        beneficios: dados.beneficios,
        especificacaoPrincipal: dados.especificacaoPrincipal,
        specsSecundarias: dados.specsSecundarias,
        ondeAplicar: dados.ondeAplicar,
      });
    } catch (err) {
      setErroAnuncio(err instanceof Error ? err.message : "Falha ao buscar o anúncio.");
    } finally {
      setBuscandoAnuncio(false);
    }
  }

  async function gerar() {
    if (!base64 || !nomeProduto.trim() || gerando) return;
    setGerando(true);
    setErroKit(null);
    setResultados(null);
    try {
      const todasReferencias = [referenciaBase64, ...referenciasGaleria].filter((v): v is string => !!v);
      const imagens = await gerarKitFotos(
        base64,
        {
          nomeProduto: nomeProduto.trim(),
          subtitulo: subtitulo.trim(),
          cores: cores.trim(),
          beneficios: paraLinhas(beneficios),
          especificacaoPrincipal: especificacaoPrincipal.trim(),
          specsSecundarias: paraLinhas(specsSecundarias),
          ondeAplicar: paraLinhas(ondeAplicar),
        },
        todasReferencias.length > 0 ? todasReferencias : undefined,
        sugestaoOriginal ?? undefined
      );
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

      {perfis.length > 0 && (
        <label className="agente-imagens-campo">
          Perfil de marca salvo (opcional) — preenche cores, referência e padrões de uma vez
          <select
            className="pergunta-textarea"
            value={perfilSelecionado}
            onChange={(e) => aplicarPerfil(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">Nenhum</option>
            {perfis.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
      )}
      {perfis.length > 0 && (
        <div className="agente-perfis-lista">
          {perfis.map((p) => (
            <span key={p.id} className="agente-perfil-chip">
              {p.nome}
              <button type="button" onClick={() => removerPerfil(p.id)} aria-label={`Excluir perfil ${p.nome}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <label className="agente-imagens-campo">
        Link de um anúncio seu no Mercado Livre (opcional) — preenche nome, foto e todos os campos de texto abaixo
        automaticamente com base no anúncio real (revise antes de gerar — é sugestão da IA)
        <div className="agente-imagens-acoes">
          <input
            type="text"
            className="pergunta-textarea"
            value={urlAnuncio}
            onChange={(e) => setUrlAnuncio(e.target.value)}
            placeholder="Cole o link do anúncio aqui"
            disabled={buscandoAnuncio}
          />
          <button
            type="button"
            className="btn-secundario"
            onClick={buscarDoAnuncio}
            disabled={!urlAnuncio.trim() || buscandoAnuncio}
          >
            {buscandoAnuncio ? "Buscando..." : "Buscar"}
          </button>
        </div>
      </label>
      {erroAnuncio && <div className="state-message state-error">{erroAnuncio}</div>}

      <label className="agente-imagens-campo">
        Foto do produto (obrigatória — ou puxada automaticamente acima)
        <input type="file" accept="image/*" onChange={onArquivo} />
      </label>
      {original && <img src={original} alt="Foto original do produto" className="agente-imagens-preview" />}

      <label className="agente-imagens-campo">
        Foto de referência de estilo (opcional) — um slide que você já gosta, a IA copia o layout/cores dele
        <input type="file" accept="image/*" onChange={onArquivoReferencia} />
      </label>
      {referenciaOriginal && (
        <img src={referenciaOriginal} alt="Referência de estilo" className="agente-imagens-preview" />
      )}

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

      <label className="agente-imagens-campo">
        Salvar cores + referência + benefícios + onde aplicar como um perfil de marca reutilizável
        <div className="agente-imagens-acoes">
          <input
            type="text"
            className="pergunta-textarea"
            value={nomeNovoPerfil}
            onChange={(e) => setNomeNovoPerfil(e.target.value)}
            placeholder="Nome do perfil, ex: Resiflex"
          />
          <button
            type="button"
            className="btn-secundario"
            onClick={salvarPerfilAtual}
            disabled={!nomeNovoPerfil.trim() || salvandoPerfil}
          >
            {salvandoPerfil ? "Salvando..." : "Salvar perfil"}
          </button>
        </div>
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
              <div className="agente-imagens-acoes">
                <a
                  className="btn-secundario"
                  href={`data:image/png;base64,${img}`}
                  download={`kit-${i + 1}-${(NOMES_SLIDES[i] ?? "slide").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`}
                >
                  Baixar
                </a>
                {perfilSelecionado !== "" && (
                  <button type="button" className="btn-secundario" onClick={() => favoritar(i)} disabled={favoritando === i}>
                    {favoritando === i ? "Favoritando..." : "☆ Favoritar como referência"}
                  </button>
                )}
              </div>
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

// Um item do feed unificado do Modo TV — mistura os "pensamentos"
// (raciocínio em texto corrido) do Analista de Ads, do Agente de Conversão
// e do Agente de Catálogo com os achados do Agente de Oportunidades, tudo
// numa linha do tempo só. Todos em texto corrido, sem card colorido por
// item. O Agente de Imagens não entra aqui: não tem um fluxo de "achados"
// próprio, é uma ferramenta sob demanda (gerar kit/arte), não um agente que
// observa sozinho.
type ItemFeedTV =
  | {
      chave: string;
      tipo: "pensamento";
      origem: "ads" | "conversao" | "catalogo";
      criadoEm: string;
      texto: string;
      janela: string | null;
    }
  | { chave: string; tipo: "oportunidade"; criadoEm: string; sku: string; titulo: string; contexto: string };

// Modo TV do escritório compartilhado — busca o feed dos agentes por conta
// própria (não depende de qual aba está ativa), atualiza sozinho a cada 1
// min e sai com Esc.
function ModoTVEscritorio({ onSair }: { onSair: () => void }) {
  const [feed, setFeed] = useState<ItemFeedTV[] | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [pensamentosAds, pensamentosConversao, pensamentosCatalogo, oportunidades] = await Promise.all([
        fetchPensamentosAds(),
        fetchPensamentosConversao(),
        fetchPensamentosCatalogo(),
        fetchOportunidades(),
      ]);

      const itens: ItemFeedTV[] = [
        ...pensamentosAds.map(
          (p): ItemFeedTV => ({
            chave: `pensamento-ads-${p.id}`,
            tipo: "pensamento",
            origem: "ads",
            criadoEm: p.criadoEm,
            texto: p.pensamento,
            janela: p.janela,
          }),
        ),
        ...pensamentosConversao.map(
          (p): ItemFeedTV => ({
            chave: `pensamento-conversao-${p.id}`,
            tipo: "pensamento",
            origem: "conversao",
            criadoEm: p.criadoEm,
            texto: p.pensamento,
            janela: null,
          }),
        ),
        ...pensamentosCatalogo.map(
          (p): ItemFeedTV => ({
            chave: `pensamento-catalogo-${p.id}`,
            tipo: "pensamento",
            origem: "catalogo",
            criadoEm: p.criadoEm,
            texto: p.pensamento,
            janela: null,
          }),
        ),
        ...oportunidades.map(
          (op): ItemFeedTV => ({
            chave: `oportunidade-${op.id}`,
            tipo: "oportunidade",
            criadoEm: op.criadoEm,
            sku: op.sku,
            titulo: op.titulo,
            contexto: op.contexto,
          }),
        ),
      ].sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime());

      setFeed(itens.slice(0, 30));
    } catch (err) {
      // Modo TV não mostra erro na tela — só mantém o último estado
      // conhecido — mas loga no console pra dar pra diagnosticar se o
      // feed parar de atualizar de novo (senão falha silenciosa demais
      // pra notar de longe).
      console.error("Modo TV: falha ao atualizar feed", err);
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

      <div className="agente-tv-feed-painel">
        <span className="painel-eyebrow">Feed dos agentes</span>
        {(!feed || feed.length === 0) && (
          <span className="financeiro-td-mudo">Ainda sem nenhuma atividade registrada.</span>
        )}
        {feed?.map((item) => (
          <ItemFeedTVCard key={item.chave} item={item} />
        ))}
      </div>

      <div className="agente-tv-sala">
        <SalaModoTV alertaAds={false} />
      </div>
    </div>
  );
}

// Posição (em % da largura/altura do vídeo) de cada crachá de nome sobre o
// vídeo do escritório — estimativa inicial de olho na referência, ainda
// precisa de ajuste fino ao vivo (não deu pra tirar print pra calibrar
// pixel a pixel). Pedir pro dono corrigir com "move [nome] mais pra
// [direção]" depois de ver em produção.
const POSICAO_CRACHA_VIDEO: { nome: string; left: string; top: string }[] = [
  { nome: "Planejador", left: "73.6%", top: "28.4%" },
  { nome: "Designer", left: "13.4%", top: "56.8%" },
  { nome: "Analista de Ads", left: "79.2%", top: "64.8%" },
  { nome: "Gestão de Oportunidades", left: "44.6%", top: "62.1%" },
  { nome: "Analista de Catálogo", left: "21.4%", top: "41.1%" },
  { nome: "Analista de Funil", left: "59.7%", top: "48.3%" },
];

// Posição de cada "tela de parede" sobre o vídeo — mesma lógica dos
// crachás: estimativa inicial, ajustada ao vivo com print.
const POSICAO_TELA_PAREDE: { chave: keyof ResumoEscritorio; rotulo: string; formatar: (v: number) => string }[] = [
  { chave: "vendasHoje", rotulo: "Vendas do dia", formatar: (v) => formatCurrency(v) },
  { chave: "conversaoMediaHoje", rotulo: "Conversão média", formatar: (v) => `${v.toFixed(1)}%` },
  { chave: "lucroAdsHoje", rotulo: "Lucro após Ads", formatar: (v) => formatCurrency(v) },
];

// Fundo em vídeo (loop) do escritório compartilhado — pedido do dono pra
// ficar mais próximo de uma referência gerada por IA, com movimento de
// verdade (o SVG desenhado por código não fica parado, mas não tem a
// riqueza visual de vídeo gerado). Cai pra sala desenhada por código
// automaticamente se o vídeo não carregar (reserva, ver EscritorioCompartilhado).
function SalaModoTV({ alertaAds }: { alertaAds: boolean }) {
  const [erroVideo, setErroVideo] = useState(false);
  const [resumo, setResumo] = useState<ResumoEscritorio | null>(null);
  const [atualizando, setAtualizando] = useState(false);

  const carregar = useCallback((forcar: boolean) => {
    if (forcar) setAtualizando(true);
    fetchResumoEscritorio(forcar)
      .then((r) => setResumo(r))
      .catch((err) => console.error("Modo TV: falha ao buscar resumo do escritório", err))
      .finally(() => {
        if (forcar) setAtualizando(false);
      });
  }, []);

  useEffect(() => {
    carregar(false);
    const intervalo = setInterval(() => carregar(false), 60000);
    return () => clearInterval(intervalo);
  }, [carregar]);

  if (erroVideo) {
    return <EscritorioCompartilhado alertaAds={alertaAds} />;
  }

  return (
    <div className="agente-tv-video-wrap">
      <video
        className="agente-tv-video"
        src="/modo-tv-escritorio.mp4"
        autoPlay
        loop
        muted
        playsInline
        onError={() => setErroVideo(true)}
      />
      <div className="agente-tv-video-overlay">
        {POSICAO_CRACHA_VIDEO.map((c) => (
          <div key={c.nome} className="agente-tv-nome-cracha" style={{ left: c.left, top: c.top }}>
            <span>{c.nome}</span>
            <span className="agente-tv-nome-cracha-dot" />
          </div>
        ))}
        {resumo && (
          <div className="agente-tv-parede-pilha">
            {POSICAO_TELA_PAREDE.map((t) => {
              const valor = resumo[t.chave];
              return (
                <div key={t.chave} className="agente-tv-parede-tela">
                  <span className="agente-tv-parede-rotulo">{t.rotulo}</span>
                  <span className="agente-tv-parede-valor">{valor !== null ? t.formatar(valor) : "—"}</span>
                </div>
              );
            })}
            <button
              type="button"
              className="agente-tv-parede-atualizar"
              onClick={() => carregar(true)}
              disabled={atualizando}
              style={{ pointerEvents: "auto" }}
            >
              {atualizando ? "Atualizando..." : "Atualizar valores"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const COR_POR_ORIGEM: Record<"ads" | "conversao" | "catalogo", string> = {
  ads: COR_ADS,
  conversao: COR_CONVERSAO,
  catalogo: COR_CATALOGO,
};
const ROTULO_POR_ORIGEM: Record<"ads" | "conversao" | "catalogo", string> = {
  ads: "Ads",
  conversao: "Conversão",
  catalogo: "Catálogo",
};

function ItemFeedTVCard({ item }: { item: ItemFeedTV }) {
  if (item.tipo === "pensamento") {
    const cor = COR_POR_ORIGEM[item.origem];
    const rotulo =
      item.origem === "ads" ? `Ads · ${item.janela === "hoje" ? "hoje" : "7 dias"}` : ROTULO_POR_ORIGEM[item.origem];
    return (
      <div className="agente-card agente-tv-card" style={{ borderLeftColor: cor }}>
        <div className="agente-card-topo">
          <span className="ads-insight-tag" style={{ color: cor }}>
            {rotulo}
          </span>
          <span className="financeiro-td-mudo">{formatDataHora(item.criadoEm)}</span>
        </div>
        <p className="agente-tv-pensamento">{item.texto}</p>
      </div>
    );
  }
  return (
    <div className="agente-card agente-tv-card" style={{ borderLeftColor: COR_OPORTUNIDADES }}>
      <div className="agente-card-topo">
        <span className="ads-insight-tag" style={{ color: COR_OPORTUNIDADES }}>
          Oportunidades · {item.sku}
        </span>
        <span className="financeiro-td-mudo">{formatDataHora(item.criadoEm)}</span>
      </div>
      <div className="financeiro-td-titulo">{item.titulo}</div>
      <p className="ads-insight-contexto">{item.contexto}</p>
    </div>
  );
}

// Sem IA de propósito — o número já conta a história sozinha (vendeu X no
// grupo, você vendeu Y), e a IA seria uma chamada por atualização (1x/dia)
// que não agrega precisão suficiente pra justificar o custo.
function AgenteOportunidades() {
  const [oportunidades, setOportunidades] = useState<Oportunidade[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setOportunidades(await fetchOportunidades());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao carregar oportunidades.");
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function verificarAgora() {
    setVerificando(true);
    setErro(null);
    try {
      await verificarOportunidadesAgora();
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao verificar.");
    } finally {
      setVerificando(false);
    }
  }

  return (
    <>
      <div className="financeiro-topo">
        <div>
          <h1>Agente de Oportunidades</h1>
          <p className="painel-sub">
            Compara vendas por SKU dos últimos 30 dias entre o grupo inteiro (16 lojas) e suas 4 lojas pessoais —
            sinaliza produto que vende bem no grupo mas tem pouca ou nenhuma representação nas suas lojas.
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

      <div className="agente-feed">
        {oportunidades !== null && oportunidades.length === 0 && (
          <div className="state-message">Nenhuma oportunidade encontrada agora.</div>
        )}
        {oportunidades?.map((o) => (
          <div key={o.id} className="agente-card" style={{ borderLeftColor: "var(--good-text)" }}>
            <div className="agente-card-topo">
              <span className="ads-insight-tag" style={{ color: "var(--good-text)" }}>
                {o.sku}
              </span>
              <span className="financeiro-td-mudo">{formatDataHora(o.criadoEm)}</span>
            </div>
            <div className="financeiro-td-titulo">{o.titulo}</div>
            <p className="ads-insight-contexto">{o.contexto}</p>
          </div>
        ))}
      </div>
    </>
  );
}

// Análise em texto corrido, 1x/dia por loja — mesmo formato do Analista de
// Ads (sem cards por anúncio), comparando a conversão (visitas x vendas) de
// cada anúncio com a média da própria loja.
function AgenteConversao() {
  const [pensamentos, setPensamentos] = useState<PensamentoConversao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lojaFiltro, setLojaFiltro] = useState<number | "todas">("todas");

  const carregar = useCallback(async () => {
    try {
      setPensamentos(await fetchPensamentosConversao());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao carregar o feed.");
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const lojasDisponiveis = new Map<number, string>();
  for (const p of pensamentos ?? []) if (p.lojaId !== null && p.lojaNome !== null) lojasDisponiveis.set(p.lojaId, p.lojaNome);

  const pensamentosDaLoja =
    lojaFiltro === "todas" ? pensamentos : (pensamentos?.filter((p) => p.lojaId === lojaFiltro) ?? null);

  return (
    <>
      <div className="financeiro-topo">
        <div>
          <h1>Agente de Conversão</h1>
          <p className="painel-sub">
            Compara visitas e vendas dos últimos 30 dias de cada anúncio com a média da própria loja — aponta quem
            tem muita visita e converte mal (photo/preço/copy) e quem converte bem mas recebe pouco tráfego.
          </p>
        </div>
        <div className="financeiro-filtros">
          <select
            className="dashboard-select"
            value={lojaFiltro}
            onChange={(e) => setLojaFiltro(e.target.value === "todas" ? "todas" : Number(e.target.value))}
          >
            <option value="todas">Todas as lojas</option>
            {[...lojasDisponiveis.entries()].map(([id, nome]) => (
              <option key={id} value={id}>
                {nome}
              </option>
            ))}
          </select>
        </div>
      </div>

      {erro && <div className="state-message state-error">{erro}</div>}

      <div className="agente-feed">
        <div className="agente-feed-topo">
          <span className="painel-eyebrow">O que ele está pensando</span>
        </div>

        {pensamentosDaLoja !== null && pensamentosDaLoja.length === 0 && (
          <div className="state-message">Nenhuma verificação registrada ainda.</div>
        )}

        {pensamentosDaLoja?.map((p) => <PensamentoCard key={p.id} pensamento={p} />)}
      </div>
    </>
  );
}

// Texto corrido, mesmo formato do Analista de Ads e do Agente de Conversão
// — a IA lê o snapshot de catálogo (price_to_win, margem) e escreve o
// resumo por loja, sem card colorido por anúncio.
function AgenteCatalogo() {
  const [pensamentos, setPensamentos] = useState<PensamentoCatalogo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lojaFiltro, setLojaFiltro] = useState<number | "todas">("todas");

  const carregar = useCallback(async () => {
    try {
      setPensamentos(await fetchPensamentosCatalogo());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao carregar o feed.");
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const lojasDisponiveis = new Map<number, string>();
  for (const p of pensamentos ?? []) if (p.lojaId !== null && p.lojaNome !== null) lojasDisponiveis.set(p.lojaId, p.lojaNome);

  const pensamentosDaLoja =
    lojaFiltro === "todas" ? pensamentos : (pensamentos?.filter((p) => p.lojaId === lojaFiltro) ?? null);

  return (
    <>
      <div className="financeiro-topo">
        <div>
          <h1>Agente de Catálogo</h1>
          <p className="painel-sub">
            Anúncios de catálogo (concorrência pelo "Comprar") que você não está ganhando agora — resume quais vale a
            pena baixar o preço pra ganhar (ainda sobra margem real) e quais não vale a briga.
          </p>
        </div>
        <div className="financeiro-filtros">
          <select
            className="dashboard-select"
            value={lojaFiltro}
            onChange={(e) => setLojaFiltro(e.target.value === "todas" ? "todas" : Number(e.target.value))}
          >
            <option value="todas">Todas as lojas</option>
            {[...lojasDisponiveis.entries()].map(([id, nome]) => (
              <option key={id} value={id}>
                {nome}
              </option>
            ))}
          </select>
        </div>
      </div>

      {erro && <div className="state-message state-error">{erro}</div>}

      <div className="agente-feed">
        <div className="agente-feed-topo">
          <span className="painel-eyebrow">O que ele está pensando</span>
        </div>

        {pensamentosDaLoja !== null && pensamentosDaLoja.length === 0 && (
          <div className="state-message">Nenhuma verificação registrada ainda.</div>
        )}

        {pensamentosDaLoja?.map((p) => <PensamentoCard key={p.id} pensamento={p} />)}
      </div>
    </>
  );
}

// Cruza as 4 lojas de propósito (ao contrário dos outros agentes, que são
// por loja) — lê o que Ads, Conversão e Catálogo escreveram nas últimas 24h
// mais as Oportunidades em aberto, e prioriza tudo junto num plano do dia
// só. 1x/dia, às 10h (depois que os agentes da manhã já rodaram).
function PlanoDoDia() {
  const [planos, setPlanos] = useState<PlanoDiario[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setPlanos(await fetchPlanoDiario());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao carregar o plano do dia.");
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function verificarAgora() {
    setVerificando(true);
    setErro(null);
    try {
      await verificarPlanoDiarioAgora();
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao verificar.");
    } finally {
      setVerificando(false);
    }
  }

  // Atualização otimista — marca na hora, sem esperar o servidor confirmar
  // (senão o clique parece travado). Se der erro, recarrega pra corrigir.
  async function alternarItem(id: number, concluidoAtual: boolean) {
    setPlanos(
      (atual) =>
        atual?.map((p) => ({
          ...p,
          itens: p.itens.map((i) => (i.id === id ? { ...i, concluido: !concluidoAtual } : i)),
        })) ?? atual
    );
    try {
      await marcarItemPlano(id, !concluidoAtual);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao marcar item.");
      await carregar();
    }
  }

  // Os planos de verdade (gerados às 8h e às 10h15, um por par de lojas) têm
  // itens marcáveis; a cobrança das 18h é só texto, sem itens próprios —
  // pega os 2 mais recentes COM itens (um de cada grupo) pra montar a
  // checklist, os outros aparecem só no histórico abaixo.
  const itensChecklist = (planos ?? []).filter((p) => p.itens.length > 0).slice(0, 2).flatMap((p) => p.itens);

  return (
    <>
      <div className="financeiro-topo">
        <div>
          <h1>Plano do Dia</h1>
          <p className="painel-sub">
            Às 8h (Inga Collors e Perpétua) e às 10h15 (Hangar e Catedral Impermeabilizantes), cruza tudo que os
            outros agentes registraram nas últimas 24h de cada par de lojas e monta um plano priorizado entre elas.
            Às 18h, cobra o que ainda ficou pendente.
          </p>
        </div>
        <div className="financeiro-filtros">
          <button type="button" className="btn-responder financeiro-btn-hoje" onClick={verificarAgora} disabled={verificando}>
            {verificando ? "Verificando..." : "Verificar agora"}
          </button>
        </div>
      </div>

      {erro && <div className="state-message state-error">{erro}</div>}

      {itensChecklist.length > 0 && (
        <div className="agente-feed">
          <div className="agente-feed-topo">
            <span className="painel-eyebrow">Checklist de hoje</span>
          </div>
          <div className="agente-checklist">
            {itensChecklist.map((item) => (
              <label key={item.id} className="agente-checklist-item">
                <input type="checkbox" checked={item.concluido} onChange={() => alternarItem(item.id, item.concluido)} />
                <span className={item.concluido ? "agente-checklist-feito" : ""}>{item.descricao}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="agente-feed">
        <div className="agente-feed-topo">
          <span className="painel-eyebrow">Plano de hoje</span>
        </div>

        {planos !== null && planos.length === 0 && (
          <div className="state-message">Nenhum plano registrado ainda.</div>
        )}

        {planos?.map((p) => <PensamentoCard key={p.id} pensamento={p} />)}
      </div>
    </>
  );
}

export function AgenciaAgentesIA() {
  const [agente, setAgente] = useState<
    "plano" | "ads" | "growth" | "imagens" | "oportunidades" | "catalogo" | "conversao"
  >("plano");
  const [modoTV, setModoTV] = useState(false);
  // Estável de propósito — se fosse uma arrow function inline no JSX, toda
  // vez que este componente re-renderiza (ex.: algo mudando mais acima na
  // árvore) o ModoTVEscritorio recebia uma prop "onSair" com identidade
  // nova, o que reinicia o useEffect de polling dele (limpa o setInterval
  // de 60s e começa de novo) — na prática o feed nunca chegava a atualizar
  // sozinho, só reabrindo o Modo TV.
  const sairDoModoTV = useCallback(() => setModoTV(false), []);

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
          className={`agente-tab ${agente === "plano" ? "agente-tab-ativa" : ""}`}
          onClick={() => setAgente("plano")}
        >
          Plano do Dia
        </button>
        <button
          type="button"
          className={`agente-tab ${agente === "ads" ? "agente-tab-ativa" : ""}`}
          onClick={() => setAgente("ads")}
        >
          Analista de Ads
        </button>
        <button
          type="button"
          className={`agente-tab ${agente === "growth" ? "agente-tab-ativa" : ""}`}
          onClick={() => setAgente("growth")}
        >
          Growth Hacker
        </button>
        <button
          type="button"
          className={`agente-tab ${agente === "imagens" ? "agente-tab-ativa" : ""}`}
          onClick={() => setAgente("imagens")}
        >
          Agente de Imagens
        </button>
        <button
          type="button"
          className={`agente-tab ${agente === "oportunidades" ? "agente-tab-ativa" : ""}`}
          onClick={() => setAgente("oportunidades")}
        >
          Agente de Oportunidades
        </button>
        <button
          type="button"
          className={`agente-tab ${agente === "catalogo" ? "agente-tab-ativa" : ""}`}
          onClick={() => setAgente("catalogo")}
        >
          Agente de Catálogo
        </button>
        <button
          type="button"
          className={`agente-tab ${agente === "conversao" ? "agente-tab-ativa" : ""}`}
          onClick={() => setAgente("conversao")}
        >
          Agente de Conversão
        </button>
      </div>

      {agente === "plano" && <PlanoDoDia />}
      {agente === "ads" && <AnalistaAds />}
      {agente === "growth" && <GrowthHacker />}
      {agente === "imagens" && <AgenteImagens />}
      {agente === "oportunidades" && <AgenteOportunidades />}
      {agente === "catalogo" && <AgenteCatalogo />}
      {agente === "conversao" && <AgenteConversao />}

      {modoTV && <ModoTVEscritorio onSair={sairDoModoTV} />}
    </div>
  );
}
