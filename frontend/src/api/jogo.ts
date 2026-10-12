import type { SemanaJogo } from "../types/jogo";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function tratarResposta<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return res.json();
}

export async function fetchSemanaJogo(): Promise<SemanaJogo> {
  const res = await fetch(`${API_BASE}/api/jogo/semana`, { credentials: "include" });
  return tratarResposta<SemanaJogo>(res);
}

export async function registrarTentativaJogo(pontuacao: number): Promise<SemanaJogo> {
  const res = await fetch(`${API_BASE}/api/jogo/tentativa`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pontuacao }),
  });
  return tratarResposta<SemanaJogo>(res);
}
