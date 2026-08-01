import type { VendaFinanceira } from "../types/financeiro";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export async function fetchVendasFinanceiras(lojaFiltro: number | "todas" | "minhas"): Promise<VendaFinanceira[]> {
  const res = await fetch(`${API_BASE}/api/financeiro?lojaId=${lojaFiltro}`, { credentials: "include" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  const data = await res.json();
  return data.vendas;
}
