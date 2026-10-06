import type { MetaControleAds, PainelControleAds } from "../types/controleAds";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function tratarResposta<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return res.json();
}

export async function fetchPainelControleAds(inicio: string, fim: string): Promise<PainelControleAds> {
  const params = new URLSearchParams({ inicio, fim });
  const res = await fetch(`${API_BASE}/api/controle-ads?${params}`, { credentials: "include" });
  return tratarResposta<PainelControleAds>(res);
}

export async function salvarMetaControleAds(lojaId: number, meta: MetaControleAds): Promise<void> {
  const res = await fetch(`${API_BASE}/api/controle-ads/metas/${lojaId}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(meta),
  });
  await tratarResposta<{ ok: true }>(res);
}
