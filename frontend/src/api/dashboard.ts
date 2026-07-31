import type { DashboardData, TopVendidoPromocao } from "../types/dashboard";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export async function fetchDashboardData(lojaId?: number | "minhas"): Promise<DashboardData> {
  const query = lojaId ? `?lojaId=${lojaId}` : "";
  const res = await fetch(`${API_BASE}/api/dashboard${query}`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Falha ao buscar dashboard: ${res.status}`);
  }
  return res.json();
}

export async function fetchTopVendidosPromocoes(lojaId?: number | "minhas"): Promise<TopVendidoPromocao[]> {
  const query = lojaId ? `?lojaId=${lojaId}` : "";
  const res = await fetch(`${API_BASE}/api/dashboard/top-vendidos${query}`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Falha ao buscar top vendidos: ${res.status}`);
  }
  const data = await res.json();
  return data.produtos;
}
