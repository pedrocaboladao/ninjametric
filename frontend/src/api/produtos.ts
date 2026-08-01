import type { Produto } from "../types/produtos";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export async function fetchProdutos(): Promise<Produto[]> {
  const res = await fetch(`${API_BASE}/api/produtos`, { credentials: "include" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  const data = await res.json();
  return data.produtos;
}
