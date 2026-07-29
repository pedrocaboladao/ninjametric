import type { Coluna, Cartao, CartaoArquivado } from "../types/tarefas";

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

export async function fetchQuadro(): Promise<Coluna[]> {
  const data = await chamar<{ colunas: Coluna[] }>("/api/tarefas/quadro");
  return data.colunas;
}

export async function criarColuna(nome: string): Promise<Coluna> {
  return chamar("/api/tarefas/colunas", { method: "POST", body: JSON.stringify({ nome }) });
}

export async function renomearColuna(id: number, nome: string): Promise<void> {
  await chamar(`/api/tarefas/colunas/${id}`, { method: "PATCH", body: JSON.stringify({ nome }) });
}

export async function excluirColuna(id: number): Promise<void> {
  await chamar(`/api/tarefas/colunas/${id}`, { method: "DELETE" });
}

export async function criarCartao(colunaId: number, titulo: string): Promise<Cartao> {
  return chamar("/api/tarefas/cartoes", { method: "POST", body: JSON.stringify({ colunaId, titulo }) });
}

export interface AtualizacaoCartao {
  titulo?: string;
  concluido?: boolean;
  colunaId?: number;
  ordem?: number;
  arquivado?: boolean;
}

export async function atualizarCartao(id: number, dados: AtualizacaoCartao): Promise<void> {
  await chamar(`/api/tarefas/cartoes/${id}`, { method: "PATCH", body: JSON.stringify(dados) });
}

export async function excluirCartao(id: number): Promise<void> {
  await chamar(`/api/tarefas/cartoes/${id}`, { method: "DELETE" });
}

export async function reindexarColuna(colunaId: number, ids: number[]): Promise<void> {
  await chamar(`/api/tarefas/colunas/${colunaId}/reindexar`, { method: "POST", body: JSON.stringify({ ids }) });
}

export async function arquivarConcluidos(): Promise<void> {
  await chamar("/api/tarefas/concluidos/arquivar", { method: "POST" });
}

export async function fetchArquivados(): Promise<CartaoArquivado[]> {
  const data = await chamar<{ cartoes: CartaoArquivado[] }>("/api/tarefas/arquivados");
  return data.cartoes;
}

export async function restaurarCartao(id: number, colunaId: number): Promise<void> {
  await chamar(`/api/tarefas/cartoes/${id}/restaurar`, { method: "POST", body: JSON.stringify({ colunaId }) });
}
