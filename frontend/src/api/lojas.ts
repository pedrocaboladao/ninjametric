export interface Loja {
  id: number;
  nome: string;
}

export interface LojaTodas extends Loja {
  autorizada: boolean;
  impostoPercentual: number;
  custoFixoMensal: number;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export async function fetchLojas(): Promise<Loja[]> {
  const res = await fetch(`${API_BASE}/api/lojas`, { credentials: "include" });
  if (!res.ok) throw new Error(`Falha ao buscar lojas: ${res.status}`);
  const data = await res.json();
  return data.lojas;
}

// Igual fetchLojas, mas só lojas com Shopee autorizado — usado nas telas da
// Shopee, já que fetchLojas filtra por Mercado Livre e deixaria de fora
// lojas só-Shopee (ex: Catedral Ferramentas).
export async function fetchLojasShopee(): Promise<Loja[]> {
  const res = await fetch(`${API_BASE}/api/lojas/shopee`, { credentials: "include" });
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

export async function atualizarImpostoLoja(id: number, impostoPercentual: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/lojas/${id}/imposto`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ impostoPercentual }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
}

export async function atualizarCustoFixoLoja(id: number, custoFixoMensal: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/lojas/${id}/custo-fixo`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ custoFixoMensal }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
}
