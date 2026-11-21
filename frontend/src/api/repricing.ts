import type {
  LojaRepricing,
  PainelPromocoes,
  PainelRepricing,
  ResultadoEmMassa,
  ResultadoPromocoes,
} from "../types/repricing";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function chamar<T>(caminho: string, opcoes?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${caminho}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opcoes,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return res.json();
}

const enviar = (metodo: "POST" | "PUT", corpo: unknown): RequestInit => ({ method: metodo, body: JSON.stringify(corpo) });

export async function fetchLojasRepricing(): Promise<LojaRepricing[]> {
  return (await chamar<{ lojas: LojaRepricing[] }>("/api/repricing/lojas")).lojas;
}

export function fetchPainelRepricing(lojaId: number): Promise<PainelRepricing> {
  return chamar(`/api/repricing?lojaId=${lojaId}`);
}

export async function salvarConfigRepricing(
  lojaId: number,
  mudancas: { margemMinimaPercentual?: number; roboPausado?: boolean; promocoesAutomaticas?: boolean }
): Promise<void> {
  await chamar("/api/repricing/config", enviar("PUT", { lojaId, ...mudancas }));
}

export async function pedirSincronizacao(lojaId: number): Promise<void> {
  await chamar("/api/repricing/sincronizar", enviar("POST", { lojaId }));
}

export async function salvarAjustesItem(
  lojaId: number,
  itemId: string,
  ajustes: { margemMinimaPercentual?: number | null; precoMaximo?: number | null }
): Promise<void> {
  await chamar(`/api/repricing/itens/${itemId}`, enviar("PUT", { lojaId, ...ajustes }));
}

export async function alternarRobo(lojaId: number, itemId: string, ligar: boolean): Promise<void> {
  await chamar(`/api/repricing/itens/${itemId}/robo`, enviar("POST", { lojaId, ligar }));
}

export async function alternarRoboEmMassa(lojaId: number, itemIds: string[], ligar: boolean): Promise<ResultadoEmMassa[]> {
  const data = await chamar<{ resultados: ResultadoEmMassa[] }>("/api/repricing/robo-em-massa", enviar("POST", { lojaId, itemIds, ligar }));
  return data.resultados;
}

export function fetchPromocoesRepricing(lojaId: number): Promise<PainelPromocoes> {
  return chamar(`/api/repricing/promocoes?lojaId=${lojaId}`);
}

export async function buscarPromocoes(lojaId: number): Promise<void> {
  await chamar("/api/repricing/promocoes/buscar", enviar("POST", { lojaId }));
}

export function entrarNasPromocoes(lojaId: number): Promise<ResultadoPromocoes> {
  return chamar("/api/repricing/promocoes/entrar", enviar("POST", { lojaId }));
}
