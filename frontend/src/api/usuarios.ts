import type { Usuario } from "../types/usuarios";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function tratarErro(res: Response): Promise<never> {
  const data = await res.json().catch(() => null);
  throw new Error(data?.error ?? `Erro ${res.status}`);
}

async function chamar<T>(caminho: string, opcoes?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${caminho}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opcoes,
  });
  if (!res.ok) return tratarErro(res);
  return res.json();
}

export async function fetchUsuarios(): Promise<Usuario[]> {
  const data = await chamar<{ usuarios: Usuario[] }>("/api/usuarios");
  return data.usuarios;
}

export async function criarUsuario(
  username: string,
  senha: string,
  nome: string,
  permissoes: string[],
  lojas: number[],
  todasLojas: boolean
): Promise<Usuario> {
  return chamar("/api/usuarios", {
    method: "POST",
    body: JSON.stringify({ username, senha, nome, permissoes, lojas, todasLojas }),
  });
}

export interface AtualizacaoUsuario {
  nome?: string;
  senha?: string;
  permissoes?: string[];
  lojas?: number[];
  todasLojas?: boolean;
}

export async function atualizarUsuario(id: number, dados: AtualizacaoUsuario): Promise<void> {
  await chamar(`/api/usuarios/${id}`, { method: "PATCH", body: JSON.stringify(dados) });
}

export async function excluirUsuario(id: number): Promise<void> {
  await chamar(`/api/usuarios/${id}`, { method: "DELETE" });
}
