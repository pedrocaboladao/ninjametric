import type { UsuarioBasico, Conversa, Mensagem } from "../types/mensagens";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function tratarResposta<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return res.json();
}

export async function fetchUsuariosParaConversa(): Promise<UsuarioBasico[]> {
  const res = await fetch(`${API_BASE}/api/mensagens/usuarios`, { credentials: "include" });
  const data = await tratarResposta<{ usuarios: UsuarioBasico[] }>(res);
  return data.usuarios;
}

export async function fetchConversas(): Promise<Conversa[]> {
  const res = await fetch(`${API_BASE}/api/mensagens`, { credentials: "include" });
  const data = await tratarResposta<{ conversas: Conversa[] }>(res);
  return data.conversas;
}

export async function fetchNaoLidas(): Promise<number> {
  const res = await fetch(`${API_BASE}/api/mensagens/nao-lidas`, { credentials: "include" });
  const data = await tratarResposta<{ total: number }>(res);
  return data.total;
}

export async function fetchMensagens(outroUsuarioId: number): Promise<Mensagem[]> {
  const res = await fetch(`${API_BASE}/api/mensagens/${outroUsuarioId}`, { credentials: "include" });
  const data = await tratarResposta<{ mensagens: Mensagem[] }>(res);
  return data.mensagens;
}

export async function enviarMensagem(outroUsuarioId: number, texto: string): Promise<Mensagem> {
  const res = await fetch(`${API_BASE}/api/mensagens/${outroUsuarioId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ texto }),
  });
  return tratarResposta<Mensagem>(res);
}
