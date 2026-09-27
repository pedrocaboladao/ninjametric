import type { TarefaAgenda, SemanaAgenda, UsuarioParaAtribuir, LojaParaAgenda, NovaTarefaAgenda } from "../types/agenda";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function tratarResposta<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return res.json();
}

export async function fetchSemanaAtual(): Promise<SemanaAgenda> {
  const res = await fetch(`${API_BASE}/api/agenda/semana`, { credentials: "include" });
  return tratarResposta<SemanaAgenda>(res);
}

export async function fetchTarefasAgenda(): Promise<TarefaAgenda[]> {
  const res = await fetch(`${API_BASE}/api/agenda/tarefas`, { credentials: "include" });
  const data = await tratarResposta<{ tarefas: TarefaAgenda[] }>(res);
  return data.tarefas;
}

export async function fetchUsuariosParaAtribuir(): Promise<UsuarioParaAtribuir[]> {
  const res = await fetch(`${API_BASE}/api/agenda/usuarios`, { credentials: "include" });
  const data = await tratarResposta<{ usuarios: UsuarioParaAtribuir[] }>(res);
  return data.usuarios;
}

export async function fetchLojasParaAgenda(): Promise<LojaParaAgenda[]> {
  const res = await fetch(`${API_BASE}/api/agenda/lojas`, { credentials: "include" });
  const data = await tratarResposta<{ lojas: LojaParaAgenda[] }>(res);
  return data.lojas;
}

export async function fetchAgendaPendentes(): Promise<number> {
  const res = await fetch(`${API_BASE}/api/agenda/pendentes`, { credentials: "include" });
  const data = await tratarResposta<{ total: number }>(res);
  return data.total;
}

export async function criarTarefaAgenda(dados: NovaTarefaAgenda): Promise<TarefaAgenda> {
  const res = await fetch(`${API_BASE}/api/agenda/tarefas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(dados),
  });
  return tratarResposta<TarefaAgenda>(res);
}

export async function atualizarTarefaAgenda(id: number, dados: Partial<NovaTarefaAgenda & { ativo: boolean }>): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agenda/tarefas/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(dados),
  });
  await tratarResposta<{ ok: true }>(res);
}

export async function excluirTarefaAgenda(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agenda/tarefas/${id}`, { method: "DELETE", credentials: "include" });
  await tratarResposta<{ ok: true }>(res);
}

export async function marcarOcorrencia(tarefaId: number, data: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agenda/tarefas/${tarefaId}/ocorrencias/${data}`, {
    method: "POST",
    credentials: "include",
  });
  await tratarResposta<{ ok: true }>(res);
}

export async function desmarcarOcorrencia(tarefaId: number, data: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agenda/tarefas/${tarefaId}/ocorrencias/${data}`, {
    method: "DELETE",
    credentials: "include",
  });
  await tratarResposta<{ ok: true }>(res);
}
