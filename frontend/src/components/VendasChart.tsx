import { useRef, useState } from "react";
import type { VendaPorHora } from "../types/dashboard";
import { formatCurrency } from "../utils/format";

interface Props {
  dados: VendaPorHora[];
}

const WIDTH = 720;
const HEIGHT = 260;
const PAD_LEFT = 56;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

function linhaSuave(pontos: Array<[number, number]>): string {
  if (pontos.length < 2) return "";
  let d = `M ${pontos[0][0]},${pontos[0][1]}`;
  for (let i = 0; i < pontos.length - 1; i++) {
    const p0 = pontos[i - 1] ?? pontos[i];
    const p1 = pontos[i];
    const p2 = pontos[i + 1];
    const p3 = pontos[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

function passoLimpo(maxValor: number): number {
  const passosBase = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000];
  const alvo = maxValor / 4;
  return passosBase.find((p) => p >= alvo) ?? Math.ceil(alvo / 1000) * 1000;
}

export function VendasChart({ dados }: Props) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const plotW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const stepX = plotW / (dados.length - 1);

  const passo = passoLimpo(Math.max(1, ...dados.map((d) => Math.max(d.hoje, d.ontem))));
  const maxEixo = passo * 4;

  function x(i: number) {
    return PAD_LEFT + i * stepX;
  }
  function y(valor: number) {
    return PAD_TOP + plotH - (valor / maxEixo) * plotH;
  }

  const pontosHoje: Array<[number, number]> = dados.map((d, i) => [x(i), y(d.hoje)]);
  const pontosOntem: Array<[number, number]> = dados.map((d, i) => [x(i), y(d.ontem)]);
  const linhaHoje = linhaSuave(pontosHoje);
  const linhaOntem = linhaSuave(pontosOntem);
  const areaHoje = `${linhaHoje} L ${x(dados.length - 1)},${y(0)} L ${x(0)},${y(0)} Z`;

  const ticksY = [0, 1, 2, 3, 4].map((i) => passo * i);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = WIDTH / rect.width;
    const localX = (e.clientX - rect.left) * scaleX;
    const idx = Math.round((localX - PAD_LEFT) / stepX);
    setHoverIndex(Math.min(Math.max(idx, 0), dados.length - 1));
  }

  const hovered = hoverIndex !== null ? dados[hoverIndex] : null;
  const tooltipLeft = hoverIndex !== null ? (x(hoverIndex) / WIDTH) * 100 : 0;
  const tooltipFlip = tooltipLeft > 70;

  return (
    <div className="chart-card">
      <div className="chart-legend">
        <span className="legend-item">
          <i className="legend-dot legend-dot-hoje" />
          Hoje
        </span>
        <span className="legend-item">
          <i className="legend-dot legend-dot-ontem" />
          Ontem
        </span>
      </div>

      <div className="chart-svg-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="chart-svg"
          role="img"
          aria-label="Vendas por hora, hoje comparado a ontem"
          onMouseMove={onMove}
          onMouseLeave={() => setHoverIndex(null)}
        >
          {ticksY.map((v) => (
            <g key={v}>
              <line x1={PAD_LEFT} y1={y(v)} x2={WIDTH - PAD_RIGHT} y2={y(v)} className="chart-grid" />
              <text x={PAD_LEFT - 10} y={y(v) + 4} className="chart-tick" textAnchor="end">
                {v === 0 ? "R$ 0" : `R$ ${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}mil`}
              </text>
            </g>
          ))}

          <path d={areaHoje} className="chart-area-hoje" />
          <path d={linhaOntem} className="chart-line chart-line-ontem" fill="none" />
          <path d={linhaHoje} className="chart-line chart-line-hoje" fill="none" />

          {dados.map((d, i) =>
            d.hora % 3 === 0 ? (
              <text key={d.hora} x={x(i)} y={HEIGHT - 6} className="chart-tick" textAnchor="middle">
                {d.hora}h
              </text>
            ) : null
          )}

          {hoverIndex !== null && (
            <>
              <line
                x1={x(hoverIndex)}
                y1={PAD_TOP}
                x2={x(hoverIndex)}
                y2={HEIGHT - PAD_BOTTOM}
                className="chart-crosshair"
              />
              <circle cx={x(hoverIndex)} cy={y(dados[hoverIndex].hoje)} r="4" className="chart-dot chart-dot-hoje" />
              <circle cx={x(hoverIndex)} cy={y(dados[hoverIndex].ontem)} r="4" className="chart-dot chart-dot-ontem" />
            </>
          )}
        </svg>

        {hovered && (
          <div
            className="chart-tooltip"
            style={{
              left: `${tooltipLeft}%`,
              transform: tooltipFlip ? "translateX(-105%)" : "translateX(8px)",
            }}
          >
            <div className="chart-tooltip-hora">{String(hovered.hora).padStart(2, "0")}h</div>
            <div className="chart-tooltip-linha">
              <i className="legend-dot legend-dot-hoje" /> Hoje <b>{formatCurrency(hovered.hoje)}</b>
            </div>
            <div className="chart-tooltip-linha">
              <i className="legend-dot legend-dot-ontem" /> Ontem <b>{formatCurrency(hovered.ontem)}</b>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
