export interface Loja {
  id: number;
  nome: string;
}

export interface LojaTodas extends Loja {
  autorizada: boolean;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export async function fetchLojas(): Promise<Loja[]> {
  const res = await fetch(`${API_BASE}/api/lojas`, { credentials: "include" });
  if (!res.ok) throw new Error(`Falha ao buscar lojas: ${res.status}`);
  const data = await res.json();
  return data.lojas;
}

export async function fetchLojasTodas(): Promise<LojaTodas[]> {
  const res = await fetch(`${API_BASE}/api/lojas/todas`, { credentials: "include" });
  if (!res.ok) throw new Error(`Falha ao buscar lojas: ${res.status}`);
  const data = await res.json();
  return data.lojas;
}
