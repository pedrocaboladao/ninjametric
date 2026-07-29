const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

export function formatPercent(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function formatCompactCurrency(value: number): string {
  if (value >= 1000) return `R$ ${(value / 1000).toFixed(1).replace(".0", "")}mil`;
  return formatCurrency(value);
}

export function formatHoraLocal(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export function formatDataHora(isoDate: string): string {
  return new Date(isoDate).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export function formatAtualizadoEm(date: Date): string {
  const dia = date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    timeZone: "America/Sao_Paulo",
  });
  const hora = date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  return `${dia} às ${hora}`;
}

const LOJA_CORES = ["var(--loja-1)", "var(--loja-2)", "var(--loja-3)", "var(--loja-4)"];

export function corDaLoja(lojaId: number): string {
  return LOJA_CORES[(lojaId - 1) % LOJA_CORES.length];
}
