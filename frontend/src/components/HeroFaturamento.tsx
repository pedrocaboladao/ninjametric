import { formatCurrency, formatPercent, formatHoraLocal } from "../utils/format";

interface Props {
  faturamentoHoje: number;
  faturamentoOntemMesmoHorario: number;
  variacaoPercentual: number | null;
  ultimaVendaEm: string | null;
  nomeLoja: string;
}

export function HeroFaturamento({
  faturamentoHoje,
  faturamentoOntemMesmoHorario,
  variacaoPercentual,
  ultimaVendaEm,
  nomeLoja,
}: Props) {
  const positivo = (variacaoPercentual ?? 0) >= 0;

  return (
    <section className="hero">
      <div className="hero-row">
        <div>
          <span className="hero-label">Faturamento bruto hoje</span>
          <div className="hero-valor">{formatCurrency(faturamentoHoje)}</div>
        </div>
        {variacaoPercentual !== null && (
          <span className={`hero-badge ${positivo ? "hero-badge-boa" : "hero-badge-ruim"}`}>
            {positivo ? "↗" : "↘"} {formatPercent(variacaoPercentual)} vs. ontem
          </span>
        )}
      </div>
      <div className="hero-row hero-row-sub">
        <span className="hero-live">
          <i className="hero-live-dot" /> {nomeLoja}
        </span>
        <span className="hero-ontem">
          Ontem neste horário: <b>{formatCurrency(faturamentoOntemMesmoHorario)}</b>
        </span>
      </div>
      {ultimaVendaEm && (
        <div className="hero-row hero-row-sub">
          <span />
          <span className="hero-ultima">Última venda às {formatHoraLocal(ultimaVendaEm)}</span>
        </div>
      )}
    </section>
  );
}
