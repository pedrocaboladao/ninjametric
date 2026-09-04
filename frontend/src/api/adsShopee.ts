import type { CampanhaAdsShopee } from "../types/adsShopee";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export async function fetchCampanhasAdsShopee(
  lojaFiltro: number | "todas" | "minhas",
  dataInicio: string,
  dataFim: string,
  forcar = false
): Promise<CampanhaAdsShopee[]> {
  const params = new URLSearchParams({ lojaId: String(lojaFiltro), dataInicio, dataFim });
  if (forcar) params.set("forcar", "1");
  const res = await fetch(`${API_BASE}/api/ads-shopee?${params}`, { credentials: "include" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  const data = await res.json();
  return data.campanhas;
}
