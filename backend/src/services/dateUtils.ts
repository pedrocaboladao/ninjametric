const BR_OFFSET = "-03:00";

function brNowParts(): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function brIso(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): string {
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${BR_OFFSET}`;
}

export interface DiaJanela {
  inicioDia: string;
  agora: string;
}

export function janelaHoje(): DiaJanela {
  const now = brNowParts();
  return {
    inicioDia: brIso(now.year, now.month, now.day, 0, 0, 0),
    agora: brIso(now.year, now.month, now.day, now.hour, now.minute, now.second),
  };
}

export function janelaOntemMesmoHorario(): DiaJanela {
  const now = brNowParts();
  const ontem = new Date(Date.UTC(now.year, now.month - 1, now.day));
  ontem.setUTCDate(ontem.getUTCDate() - 1);
  const y = ontem.getUTCFullYear();
  const m = ontem.getUTCMonth() + 1;
  const d = ontem.getUTCDate();
  return {
    inicioDia: brIso(y, m, d, 0, 0, 0),
    agora: brIso(y, m, d, now.hour, now.minute, now.second),
  };
}

export function horaLocal(dateIso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(dateIso));
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
}
