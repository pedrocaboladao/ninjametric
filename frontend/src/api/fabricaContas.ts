import type {
  Conta,
  ContaEntrada,
  ResumoContas,
  StatusConta,
  TipoConta,
} from "../types/fabricaContas";

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

function query(filtro: { tipo?: TipoConta; status?: StatusConta; de?: string; ate?: string }) {
  const q = new URLSearchParams();
  if (filtro.tipo) q.set("tipo", filtro.tipo);
  if (filtro.status) q.set("status", filtro.status);
  if (filtro.de) q.set("de", filtro.de);
  if (filtro.ate) q.set("ate", filtro.ate);
  return q.toString();
}

export async function fetchContas(filtro: {
  tipo?: TipoConta;
  status?: StatusConta;
  de?: string;
  ate?: string;
} = {}): Promise<Conta[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-contas?${query(filtro)}`, {
    credentials: "include",
  });
  return (await tratarResposta<{ contas: Conta[] }>(res)).contas;
}

export async function fetchResumoContas(filtro: { de?: string; ate?: string } = {}): Promise<ResumoContas> {
  const res = await fetch(`${API_BASE}/api/fabrica-contas/resumo?${query(filtro)}`, {
    credentials: "include",
  });
  return (await tratarResposta<{ resumo: ResumoContas }>(res)).resumo;
}

export async function criarConta(entrada: ContaEntrada): Promise<{ ids: number[] }> {
  const res = await fetch(`${API_BASE}/api/fabrica-contas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  return tratarResposta<{ ids: number[] }>(res);
}

export async function atualizarConta(id: number, entrada: ContaEntrada): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-contas/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  await semConteudo(res);
}

export async function definirStatusConta(
  id: number,
  status: StatusConta,
  dataPagamento?: string | null
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-contas/${id}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ status, dataPagamento: dataPagamento ?? null }),
  });
  await semConteudo(res);
}

export async function excluirConta(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-contas/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await semConteudo(res);
}
