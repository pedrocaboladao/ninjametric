import type { Bem, BemEntrada } from "../types/fabricaBens";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function tratarResposta<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return res.json();
}

async function semConteudo(res: Response): Promise<void> {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
}

export async function fetchBens(): Promise<Bem[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-bens`, { credentials: "include" });
  return (await tratarResposta<{ bens: Bem[] }>(res)).bens;
}

export async function criarBem(entrada: BemEntrada): Promise<{ id: number }> {
  const res = await fetch(`${API_BASE}/api/fabrica-bens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  return tratarResposta<{ id: number }>(res);
}

export async function atualizarBem(id: number, entrada: BemEntrada): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-bens/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  return semConteudo(res);
}

export async function excluirBem(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-bens/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  return semConteudo(res);
}
