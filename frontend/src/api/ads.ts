import type { CampanhaAds, ReceitaRealCampanha, DiagnosticoOrcamento } from "../types/ads";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export async function fetchCampanhasAds(
  lojaFiltro: number | "todas" | "minhas",
  dataInicio: string,
  dataFim: string,
  forcar = false
): Promise<CampanhaAds[]> {
  const params = new URLSearchParams({ lojaId: String(lojaFiltro), dataInicio, dataFim });
  if (forcar) params.set("forcar", "1");
  const res = await fetch(`${API_BASE}/api/ads?${params}`, { credentials: "include" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  const data = await res.json();
  return data.campanhas;
}

export async function fetchDiagnosticoOrcamento(
  lojaFiltro: number | "todas" | "minhas"
): Promise<DiagnosticoOrcamento[]> {
  const params = new URLSearchParams({ lojaId: String(lojaFiltro) });
  const res = await fetch(`${API_BASE}/api/ads/diagnostico-orcamento?${params}`, { credentials: "include" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  const data = await res.json();
  return data.campanhas;
}

export async function fetchReceitaRealPorCampanha(
  lojaFiltro: number | "todas" | "minhas",
  dataInicio: string,
  dataFim: string
): Promise<ReceitaRealCampanha[]> {
  const params = new URLSearchParams({ lojaId: String(lojaFiltro), dataInicio, dataFim });
  const res = await fetch(`${API_BASE}/api/ads/tacos?${params}`, { credentials: "include" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  const data = await res.json();
  return data.receitas;
}
