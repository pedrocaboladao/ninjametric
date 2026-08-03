import type { DashboardData, TopVendidoPromocao, RankingPrecificacao, ComparacaoSkuLoja } from "../types/dashboard";

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

export async function fetchRankingPrecificacao(lojaId?: number | "minhas"): Promise<RankingPrecificacao> {
  const query = lojaId ? `?lojaId=${lojaId}` : "";
  const res = await fetch(`${API_BASE}/api/dashboard/precificacao${query}`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Falha ao buscar ranking de precificação: ${res.status}`);
  }
  return res.json();
}

export async function fetchComparacaoPorSku(
  sku: string,
  lojaId?: number | "minhas"
): Promise<ComparacaoSkuLoja[]> {
  const params = new URLSearchParams({ sku });
  if (lojaId) params.set("lojaId", String(lojaId));
  const res = await fetch(`${API_BASE}/api/dashboard/precificacao/sku?${params}`, { credentials: "include" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Falha ao buscar comparação por SKU: ${res.status}`);
  }
  const data = await res.json();
  return data.comparacao;
}
