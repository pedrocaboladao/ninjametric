import type { PontoEquilibrio, ResultadoFinanceiro } from "../types/financeiro";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export async function fetchVendasFinanceiras(
  lojaFiltro: number | "todas" | "minhas",
  dataInicio: string,
  dataFim: string,
  forcar = false
): Promise<ResultadoFinanceiro> {
  const params = new URLSearchParams({ lojaId: String(lojaFiltro), dataInicio, dataFim });
  if (forcar) params.set("forcar", "1");
  const res = await fetch(`${API_BASE}/api/financeiro?${params}`, { credentials: "include" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return res.json();
}

export async function fetchPontoEquilibrio(lojaFiltro: number | "todas" | "minhas"): Promise<PontoEquilibrio> {
  const params = new URLSearchParams({ lojaId: String(lojaFiltro) });
  const res = await fetch(`${API_BASE}/api/financeiro/ponto-equilibrio?${params}`, { credentials: "include" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return res.json();
}

export async function atualizarCustoFixoMensal(valor: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/financeiro/custo-fixo`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ custoFixoMensal: valor }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
}
