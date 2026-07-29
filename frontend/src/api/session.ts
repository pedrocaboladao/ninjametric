import type { Usuario } from "../types/usuarios";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export async function login(username: string, password: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/session/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "Usuário ou senha inválidos.");
  }
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/api/session/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export async function checarSessao(): Promise<Usuario | null> {
  const res = await fetch(`${API_BASE}/api/session/me`, { credentials: "include" });
  if (!res.ok) return null;
  const data = await res.json();
  return data.autenticado ? (data.usuario as Usuario) : null;
}
