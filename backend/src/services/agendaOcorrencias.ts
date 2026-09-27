// Matemática pura da recorrência de cadência fixa da Agenda — sem `pool`,
// sem `Date.now()`. Cadência fixa: uma ocorrência cai em data_inicio +
// k*intervalo_dias (k inteiro >= 0) e NUNCA desliza a partir de quando foi
// marcada como feita (decisão explícita do dono — ver plano do módulo).

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Diferença em dias entre duas datas "YYYY-MM-DD" — datas de calendário
// puras (sem fuso horário envolvido, já que ambas já são strings de
// calendário, não instantes de tempo).
export function diasEntre(dataInicio: string, data: string): number {
  const [y1, m1, d1] = dataInicio.split("-").map(Number);
  const [y2, m2, d2] = data.split("-").map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86400000);
}

export function ehOcorrencia(dataInicio: string, intervaloDias: number, data: string): boolean {
  const diff = diasEntre(dataInicio, data);
  return diff >= 0 && diff % intervaloDias === 0;
}

// Segunda a domingo da semana que contém `hojeISO` — recebe "hoje" já
// resolvido pelo chamador (via dataISOBR(new Date()) do dateUtils.ts, o
// helper correto de fuso América/São_Paulo). Esta função é pura: uma vez que
// `hojeISO` já está certo, a aritmética de calendário aqui em cima via
// Date.UTC é segura, sem nenhum novo arredondamento de fuso envolvido.
export function semanaDe(hojeISO: string): { inicioSemana: string; fimSemana: string; dias: string[] } {
  const [y, m, d] = hojeISO.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const diaSemana = base.getUTCDay(); // 0=domingo..6=sábado
  const offsetSegunda = diaSemana === 0 ? -6 : 1 - diaSemana;
  const dias: string[] = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(base);
    dt.setUTCDate(base.getUTCDate() + offsetSegunda + i);
    dias.push(`${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`);
  }
  return { inicioSemana: dias[0], fimSemana: dias[6], dias };
}

export function ocorrenciasNaSemana(dataInicio: string, intervaloDias: number, dias: string[]): string[] {
  return dias.filter((d) => ehOcorrencia(dataInicio, intervaloDias, d));
}
