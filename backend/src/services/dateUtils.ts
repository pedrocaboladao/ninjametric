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

// Constrói uma janela a partir de duas datas escolhidas pelo usuário
// ("YYYY-MM-DD", como vem de um <input type="date">) — do início do primeiro
// dia até o fim do último.
export function janelaEntre(dataInicio: string, dataFim: string): DiaJanela {
  const [yi, mi, di] = dataInicio.split("-").map(Number);
  const [yf, mf, df] = dataFim.split("-").map(Number);
  return {
    inicioDia: brIso(yi, mi, di, 0, 0, 0),
    agora: brIso(yf, mf, df, 23, 59, 59),
  };
}

// Do dia 1 do mês corrente (00:00) até agora — usado no ponto de equilíbrio,
// que é sempre "o mês atual", independente do período escolhido nos filtros
// do Financeiro.
export function janelaMesAtual(): DiaJanela & { diasDecorridos: number; diasNoMes: number } {
  const now = brNowParts();
  const diasNoMes = new Date(Date.UTC(now.year, now.month, 0)).getUTCDate();
  return {
    inicioDia: brIso(now.year, now.month, 1, 0, 0, 0),
    agora: brIso(now.year, now.month, now.day, now.hour, now.minute, now.second),
    diasDecorridos: now.day,
    diasNoMes,
  };
}

export function janelaUltimosDias(dias: number): DiaJanela {
  const now = brNowParts();
  const inicio = new Date(Date.UTC(now.year, now.month - 1, now.day));
  inicio.setUTCDate(inicio.getUTCDate() - dias);
  return {
    inicioDia: brIso(inicio.getUTCFullYear(), inicio.getUTCMonth() + 1, inicio.getUTCDate(), 0, 0, 0),
    agora: brIso(now.year, now.month, now.day, now.hour, now.minute, now.second),
  };
}

// Retorna uma chave estável que só muda quando o horário local cruza um dos
// horários-âncora informados (ex.: [8, 15] -> muda às 8h e às 15h). Serve para
// um cache que atualiza só algumas vezes por dia em horários fixos, em vez de
// usar um TTL corrido. Antes da primeira âncora do dia, usa a última âncora
// do dia anterior (ex.: às 3h da manhã, ainda vale a janela das 15h de ontem).
export function chaveJanelaDoDia(horariosAncora: number[]): string {
  const now = brNowParts();
  const ancoras = [...horariosAncora].sort((a, b) => a - b);
  const data = new Date(Date.UTC(now.year, now.month - 1, now.day));

  let escolhida = -1;
  for (const h of ancoras) {
    if (now.hour >= h) escolhida = h;
  }
  if (escolhida === -1) {
    data.setUTCDate(data.getUTCDate() - 1);
    escolhida = ancoras[ancoras.length - 1];
  }

  return `${data.getUTCFullYear()}-${pad(data.getUTCMonth() + 1)}-${pad(data.getUTCDate())}T${pad(escolhida)}`;
}

export function horaLocal(dateIso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(dateIso));
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
}
