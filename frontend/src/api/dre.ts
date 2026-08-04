import type { Dre } from "../types/dre";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export async function fetchDre(ano: number, lojaFiltro: number | "todas" | "minhas"): Promise<Dre> {
  const params = new URLSearchParams({ ano: String(ano), lojaId: String(lojaFiltro) });
  const res = await fetch(`${API_BASE}/api/dre?${params}`, { credentials: "include" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return res.json();
}
