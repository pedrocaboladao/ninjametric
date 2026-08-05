import type { SkuSemCusto } from "../types/correcoes";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export async function fetchSkusSemCusto(
  lojaFiltro: number | "todas" | "minhas",
  forcar = false
): Promise<SkuSemCusto[]> {
  const params = new URLSearchParams({ lojaId: String(lojaFiltro) });
  if (forcar) params.set("forcar", "1");
  const res = await fetch(`${API_BASE}/api/correcoes?${params}`, { credentials: "include" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  const data = await res.json();
  return data.itens;
}
