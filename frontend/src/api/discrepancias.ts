import type { Discrepancia, RankingDiscrepancias } from "../types/discrepancias";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function tratarResposta<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return res.json();
}

export async function fetchDiscrepancias(): Promise<Discrepancia[]> {
  const res = await fetch(`${API_BASE}/api/discrepancias`, { credentials: "include" });
  const data = await tratarResposta<{ discrepancias: Discrepancia[] }>(res);
  return data.discrepancias;
}

export async function criarDiscrepancia(link: string): Promise<Discrepancia> {
  const res = await fetch(`${API_BASE}/api/discrepancias`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ link }),
  });
  const data = await tratarResposta<{ discrepancia: Discrepancia }>(res);
  return data.discrepancia;
}

export async function excluirDiscrepancia(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/discrepancias/${id}`, { method: "DELETE", credentials: "include" });
  await tratarResposta(res);
}

export async function fetchRankingDiscrepancias(): Promise<RankingDiscrepancias> {
  const res = await fetch(`${API_BASE}/api/discrepancias/ranking`, { credentials: "include" });
  return tratarResposta<RankingDiscrepancias>(res);
}
