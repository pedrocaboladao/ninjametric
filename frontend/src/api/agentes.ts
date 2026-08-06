import type { ObservacaoAds } from "../types/agentes";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function tratarResposta<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return res.json();
}

export async function fetchFeedAds(status?: "pendente" | "resolvida"): Promise<ObservacaoAds[]> {
  const params = status ? `?status=${status}` : "";
  const res = await fetch(`${API_BASE}/api/agentes/ads/feed${params}`, { credentials: "include" });
  const data = await tratarResposta<{ observacoes: ObservacaoAds[] }>(res);
  return data.observacoes;
}

export async function verificarAgenteAdsAgora(): Promise<{ novas: number; resolvidasSozinhas: number }> {
  const res = await fetch(`${API_BASE}/api/agentes/ads/verificar`, { method: "POST", credentials: "include" });
  return tratarResposta(res);
}

export async function confirmarObservacaoAds(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agentes/ads/${id}/confirmar`, { method: "POST", credentials: "include" });
  await tratarResposta(res);
}
