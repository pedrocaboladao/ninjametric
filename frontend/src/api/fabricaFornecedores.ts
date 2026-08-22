import type {
  Fornecedor,
  FornecedorEntrada,
  FornecedorPendente,
} from "../types/fabricaFornecedores";

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

export async function fetchFornecedores(): Promise<Fornecedor[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-fornecedores`, { credentials: "include" });
  return (await tratarResposta<{ fornecedores: Fornecedor[] }>(res)).fornecedores;
}

export async function fetchFornecedoresPendentes(): Promise<FornecedorPendente[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-fornecedores/pendentes`, {
    credentials: "include",
  });
  return (await tratarResposta<{ pendentes: FornecedorPendente[] }>(res)).pendentes;
}

export async function criarFornecedor(entrada: FornecedorEntrada): Promise<{ id: number }> {
  const res = await fetch(`${API_BASE}/api/fabrica-fornecedores`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  return tratarResposta<{ id: number }>(res);
}

export async function atualizarFornecedor(
  id: number,
  entrada: FornecedorEntrada
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-fornecedores/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  return semConteudo(res);
}

export async function excluirFornecedor(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-fornecedores/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  return semConteudo(res);
}
