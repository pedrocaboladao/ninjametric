import type {
  TarefaAgenda,
  SemanaAgenda,
  UsuarioParaAtribuir,
  LojaParaAgenda,
  NovaTarefaAgenda,
  RelatorioAgenda,
  NovoRelatorioAgenda,
  PromocaoDaLoja,
  ColunaQuadroAgenda,
  DadosCardQuadroAgenda,
  AnexoCardAgenda,
} from "../types/agenda";

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

export async function fetchPromocoesDasLojas(): Promise<PromocaoDaLoja[]> {
  const res = await fetch(`${API_BASE}/api/agenda/promocoes`, { credentials: "include" });
  const data = await tratarResposta<{ promocoes: PromocaoDaLoja[] }>(res);
  return data.promocoes;
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

export async function fetchRelatoriosAgenda(): Promise<RelatorioAgenda[]> {
  const res = await fetch(`${API_BASE}/api/agenda/relatorios`, { credentials: "include" });
  const data = await tratarResposta<{ relatorios: RelatorioAgenda[] }>(res);
  return data.relatorios;
}

export async function criarRelatorioAgenda(dados: NovoRelatorioAgenda): Promise<RelatorioAgenda> {
  const res = await fetch(`${API_BASE}/api/agenda/relatorios`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(dados),
  });
  return tratarResposta<RelatorioAgenda>(res);
}

export async function excluirRelatorioAgenda(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agenda/relatorios/${id}`, { method: "DELETE", credentials: "include" });
  await tratarResposta<{ ok: true }>(res);
}

export async function fetchQuadroAgenda(): Promise<ColunaQuadroAgenda[]> {
  const res = await fetch(`${API_BASE}/api/agenda/quadro`, { credentials: "include" });
  const data = await tratarResposta<{ colunas: ColunaQuadroAgenda[] }>(res);
  return data.colunas;
}

export async function criarColunaQuadroAgenda(nome: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agenda/quadro/colunas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ nome }),
  });
  await tratarResposta<{ ok: true }>(res);
}

export async function renomearColunaQuadroAgenda(id: number, nome: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agenda/quadro/colunas/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ nome }),
  });
  await tratarResposta<{ ok: true }>(res);
}

export async function excluirColunaQuadroAgenda(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agenda/quadro/colunas/${id}`, { method: "DELETE", credentials: "include" });
  await tratarResposta<{ ok: true }>(res);
}

export async function criarCardQuadroAgenda(colunaId: number, dados: DadosCardQuadroAgenda): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agenda/quadro/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ colunaId, ...dados }),
  });
  await tratarResposta<{ ok: true }>(res);
}

export async function atualizarCardQuadroAgenda(id: number, dados: Partial<DadosCardQuadroAgenda>): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agenda/quadro/cards/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(dados),
  });
  await tratarResposta<{ ok: true }>(res);
}

export async function moverCardQuadroAgenda(id: number, colunaId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agenda/quadro/cards/${id}/mover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ colunaId }),
  });
  await tratarResposta<{ ok: true }>(res);
}

export async function excluirCardQuadroAgenda(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agenda/quadro/cards/${id}`, { method: "DELETE", credentials: "include" });
  await tratarResposta<{ ok: true }>(res);
}

export async function fetchAnexosCardAgenda(cardId: number): Promise<AnexoCardAgenda[]> {
  const res = await fetch(`${API_BASE}/api/agenda/quadro/cards/${cardId}/anexos`, { credentials: "include" });
  const data = await tratarResposta<{ anexos: AnexoCardAgenda[] }>(res);
  return data.anexos;
}

export async function enviarAnexoCardAgenda(cardId: number, arquivo: File): Promise<void> {
  const corpo = new FormData();
  corpo.append("arquivo", arquivo);
  const res = await fetch(`${API_BASE}/api/agenda/quadro/cards/${cardId}/anexos`, {
    method: "POST",
    credentials: "include",
    body: corpo,
  });
  await tratarResposta<{ ok: true }>(res);
}

export async function excluirAnexoCardAgenda(anexoId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agenda/quadro/anexos/${anexoId}`, { method: "DELETE", credentials: "include" });
  await tratarResposta<{ ok: true }>(res);
}

export async function definirCapaAnexoAgenda(anexoId: number, marcar: boolean): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agenda/quadro/anexos/${anexoId}/capa`, {
    method: marcar ? "POST" : "DELETE",
    credentials: "include",
  });
  await tratarResposta<{ ok: true }>(res);
}

export function urlAnexoCardAgenda(anexoId: number): string {
  return `${API_BASE}/api/agenda/quadro/anexos/${anexoId}`;
}
