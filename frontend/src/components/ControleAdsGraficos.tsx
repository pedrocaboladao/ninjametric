import { useState } from "react";
import type { DiaControleAds, NivelControleAds } from "../types/controleAds";

// Gráficos em SVG puro (sem biblioteca). Cores vêm das variáveis --pbi-* definidas em ControleAds.css.

export const COR_NIVEL: Record<NivelControleAds, string> = {
  motor: "var(--pbi-verde)",
  atencao: "var(--pbi-ambar)",
  sangria: "var(--pbi-vermelho)",
  sem_dados: "var(--pbi-muted)",
};

const moedaCompacta = new Intl.NumberFormat("pt-BR", { notation: "compact", style: "currency", currency: "BRL" });
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

// ---------- Velocímetro de margem (semicírculo com faixas) ----------
export function Velocimetro({
  valor,
  min,
  max,
  atencao,
  motor,
}: {
  valor: number | null;
  min: number;
  max: number;
  atencao: number;
  motor: number;
}) {
  const W = 200;
  const H = 118;
  const cx = 100;
  const cy = 104;
  const r = 84;
  const espessura = 16;
  const fracao = (v: number) => clamp((v - min) / (max - min), 0, 1);
  const ponto = (f: number, raio = r) => {
    const teta = Math.PI * (1 - f);
    return `${(cx + raio * Math.cos(teta)).toFixed(2)},${(cy - raio * Math.sin(teta)).toFixed(2)}`;
  };
  const arco = (f1: number, f2: number) => `M ${ponto(f1)} A ${r} ${r} 0 0 1 ${ponto(f2)}`;
  const fA = fracao(atencao);
  const fM = fracao(motor);
  const faixas = [
    { a: 0, b: fA, cor: "var(--pbi-vermelho)" },
    { a: fA, b: fM, cor: "var(--pbi-ambar)" },
    { a: fM, b: 1, cor: "var(--pbi-verde)" },
  ];
  const agulha = valor === null ? null : ponto(fracao(valor), r - espessura);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pbi-velocimetro" role="img" aria-label={valor === null ? "Sem dados" : `Margem ${valor.toFixed(1)}%`}>
      <path d={arco(0, 1)} fill="none" stroke="var(--pbi-trilho)" strokeWidth={espessura} />
      {faixas.map((f) => (
        <path key={f.cor} d={arco(f.a, f.b)} fill="none" stroke={f.cor} strokeWidth={espessura} opacity={0.85} />
      ))}
      {agulha && (
        <>
          <line x1={cx} y1={cy} x2={agulha.split(",")[0]} y2={agulha.split(",")[1]} stroke="var(--pbi-texto)" strokeWidth={3} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={6} fill="var(--pbi-texto)" />
        </>
      )}
      <text x={cx} y={cy - 22} textAnchor="middle" className="pbi-velocimetro-valor">
        {valor === null ? "—" : `${valor.toFixed(1)}%`}
      </text>
    </svg>
  );
}

// ---------- Linha diária: venda (área) x gasto (linha), com cursor ----------
export function LinhaDiaria({ diario }: { diario: DiaControleAds[] }) {
  const [indice, setIndice] = useState<number | null>(null);
  const W = 640;
  const H = 240;
  const pad = { l: 56, r: 12, t: 14, b: 28 };
  const w = W - pad.l - pad.r;
  const h = H - pad.t - pad.b;
  const n = diario.length;
  if (n < 2) return <div className="pbi-vazio">Sem dias suficientes para o gráfico.</div>;
  const ymax = Math.max(1, ...diario.flatMap((d) => [d.gasto, d.faturamento])) * 1.1;
  const x = (i: number) => pad.l + (i * w) / (n - 1);
  const y = (v: number) => pad.t + (1 - v / ymax) * h;
  const linha = (valor: (d: DiaControleAds) => number) => diario.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(valor(d)).toFixed(1)}`).join(" ");
  const areaVenda = `${linha((d) => d.faturamento)} L ${x(n - 1).toFixed(1)} ${y(0)} L ${x(0).toFixed(1)} ${y(0)} Z`;
  const ticksY = [0, 0.25, 0.5, 0.75, 1].map((f) => f * ymax);
  const passoX = Math.max(1, Math.ceil(n / 7));
  const atual = indice !== null ? diario[indice] : null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="pbi-linha"
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const xVb = ((e.clientX - rect.left) / rect.width) * W;
        const i = Math.round(((xVb - pad.l) / w) * (n - 1));
        setIndice(clamp(i, 0, n - 1));
      }}
      onMouseLeave={() => setIndice(null)}
    >
      {ticksY.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="pbi-grade" />
          <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="pbi-eixo">
            {moedaCompacta.format(t)}
          </text>
        </g>
      ))}
      {diario.map((d, i) =>
        i % passoX === 0 ? (
          <text key={d.data} x={x(i)} y={H - 8} textAnchor="middle" className="pbi-eixo">
            {dataCurta(d.data)}
          </text>
        ) : null
      )}
      <path d={areaVenda} fill="var(--pbi-verde)" opacity={0.16} />
      <path d={linha((d) => d.faturamento)} fill="none" stroke="var(--pbi-verde)" strokeWidth={2.5} strokeLinejoin="round" />
      <path d={linha((d) => d.gasto)} fill="none" stroke="var(--pbi-vermelho)" strokeWidth={2.5} strokeLinejoin="round" strokeDasharray="0" />
      {atual && indice !== null && (
        <g>
          <line x1={x(indice)} x2={x(indice)} y1={pad.t} y2={pad.t + h} className="pbi-cursor" />
          <circle cx={x(indice)} cy={y(atual.faturamento)} r={4.5} fill="var(--pbi-verde)" />
          <circle cx={x(indice)} cy={y(atual.gasto)} r={4.5} fill="var(--pbi-vermelho)" />
          <g transform={`translate(${clamp(x(indice) + 10, pad.l, W - 170)}, ${pad.t + 4})`}>
            <rect width={160} height={62} rx={8} className="pbi-tooltip" />
            <text x={10} y={18} className="pbi-tooltip-titulo">{dataCurta(atual.data)}</text>
            <text x={10} y={36} className="pbi-tooltip-linha" fill="var(--pbi-verde)">Venda {moeda.format(atual.faturamento)}</text>
            <text x={10} y={54} className="pbi-tooltip-linha" fill="var(--pbi-vermelho)">Gasto {moeda.format(atual.gasto)}</text>
          </g>
        </g>
      )}
    </svg>
  );
}

// ---------- Dispersão: ROAS (x) × margem pós Ads (y), tamanho = gasto ----------
export interface PontoDispersao {
  chave: string;
  titulo: string;
  x: number;
  y: number;
  gasto: number;
  nivel: NivelControleAds;
}

export function Dispersao({ pontos }: { pontos: PontoDispersao[] }) {
  const W = 640;
  const H = 280;
  const pad = { l: 52, r: 16, t: 16, b: 34 };
  const w = W - pad.l - pad.r;
  const h = H - pad.t - pad.b;
  if (pontos.length === 0) return <div className="pbi-vazio">Nenhuma campanha com ROAS e margem calculados.</div>;
  const xmax = Math.max(4, ...pontos.map((p) => p.x)) * 1.1;
  const ymin = Math.min(-20, ...pontos.map((p) => p.y)) - 5;
  const ymax = Math.max(40, ...pontos.map((p) => p.y)) + 5;
  const px = (v: number) => pad.l + (v / xmax) * w;
  const py = (v: number) => pad.t + (1 - (v - ymin) / (ymax - ymin)) * h;
  const gastoMax = Math.max(1, ...pontos.map((p) => p.gasto));
  const ticksX = [0, 0.25, 0.5, 0.75, 1].map((f) => f * xmax);
  const ticksY = [ymin, 0, 20, 40, ymax].map((v) => Math.round(v));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pbi-dispersao" role="img" aria-label="ROAS por margem pós Ads">
      {ticksY.map((t) => (
        <g key={`y${t}`}>
          <line x1={pad.l} x2={W - pad.r} y1={py(t)} y2={py(t)} className={t === 0 ? "pbi-zero" : "pbi-grade"} />
          <text x={pad.l - 8} y={py(t) + 4} textAnchor="end" className="pbi-eixo">{t}%</text>
        </g>
      ))}
      {ticksX.map((t) => (
        <text key={`x${t}`} x={px(t)} y={H - 10} textAnchor="middle" className="pbi-eixo">{t.toFixed(1)}x</text>
      ))}
      <text x={W / 2} y={H - 0} textAnchor="middle" className="pbi-eixo-titulo">ROAS →</text>
      {pontos.map((p) => {
        const raio = clamp(Math.sqrt(p.gasto / gastoMax) * 22, 5, 22);
        return (
          <circle
            key={p.chave}
            cx={px(p.x)}
            cy={py(p.y)}
            r={raio}
            fill={COR_NIVEL[p.nivel]}
            fillOpacity={0.55}
            stroke={COR_NIVEL[p.nivel]}
            strokeWidth={1.5}
          >
            <title>{`${p.titulo}\nROAS ${p.x.toFixed(2)}x · margem ${p.y.toFixed(1)}% · gasto ${moeda.format(p.gasto)}`}</title>
          </circle>
        );
      })}
    </svg>
  );
}

// ---------- Rosca: distribuição do gasto por faixa ----------
export function Rosca({ fatias, centro }: { fatias: { label: string; valor: number; cor: string }[]; centro: string }) {
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  const r = 70;
  const C = 2 * Math.PI * r;
  let acumulado = 0;
  return (
    <div className="pbi-rosca">
      <svg viewBox="0 0 180 180" width={180} height={180} role="img" aria-label="Distribuição do gasto">
        <circle cx={90} cy={90} r={r} fill="none" stroke="var(--pbi-trilho)" strokeWidth={22} />
        {total > 0 &&
          fatias.map((f) => {
            const frac = f.valor / total;
            const tamanho = frac * C;
            const deslocamento = -acumulado * C;
            acumulado += frac;
            return (
              <circle
                key={f.label}
                cx={90}
                cy={90}
                r={r}
                fill="none"
                stroke={f.cor}
                strokeWidth={22}
                strokeDasharray={`${tamanho} ${C - tamanho}`}
                strokeDashoffset={deslocamento}
                transform="rotate(-90 90 90)"
              />
            );
          })}
        <text x={90} y={88} textAnchor="middle" className="pbi-rosca-centro">{centro}</text>
        <text x={90} y={108} textAnchor="middle" className="pbi-eixo">gasto no período</text>
      </svg>
      <ul className="pbi-rosca-legenda">
        {fatias.map((f) => (
          <li key={f.label}>
            <span className="pbi-bolinha" style={{ background: f.cor }} />
            {f.label}
            <b>{total > 0 ? `${Math.round((f.valor / total) * 100)}%` : "—"}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Mini área (sparkline dos KPIs) ----------
export function MiniArea({ valores, cor }: { valores: number[]; cor: string }) {
  if (valores.length < 2) return null;
  const W = 120;
  const H = 36;
  const max = Math.max(1, ...valores);
  const pts = valores.map((v, i) => `${((i / (valores.length - 1)) * W).toFixed(1)},${(H - (v / max) * (H - 4) - 2).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pbi-mini" preserveAspectRatio="none">
      <polygon points={`0,${H} ${pts.join(" ")} ${W},${H}`} fill={cor} opacity={0.15} />
      <polyline points={pts.join(" ")} fill="none" stroke={cor} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
