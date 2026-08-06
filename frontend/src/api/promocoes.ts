import type { Campanha, ResultadoCriarCampanha } from "../types/promocoes";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function tratarResposta<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return res.json();
}

export async function fetchCampanhas(lojaFiltro: number | "todas" | "minhas"): Promise<Campanha[]> {
  const params = new URLSearchParams({ lojaId: String(lojaFiltro) });
  const res = await fetch(`${API_BASE}/api/promocoes?${params}`, { credentials: "include" });
  const data = await tratarResposta<{ campanhas: Campanha[] }>(res);
  return data.campanhas;
}

export async function criarCampanha(
  lojaId: number,
  nome: string,
  percentual: number,
  itemIds: string[]
): Promise<ResultadoCriarCampanha> {
  const res = await fetch(`${API_BASE}/api/promocoes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ lojaId, nome, percentual, itemIds }),
  });
  return tratarResposta<ResultadoCriarCampanha>(res);
}

export async function recriarCampanha(id: number): Promise<ResultadoCriarCampanha> {
  const res = await fetch(`${API_BASE}/api/promocoes/${id}/recriar`, {
    method: "POST",
    credentials: "include",
  });
  return tratarResposta<ResultadoCriarCampanha>(res);
}
