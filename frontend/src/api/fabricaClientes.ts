import type { FabricaCliente, FabricaClienteEntrada } from "../types/fabricaClientes";

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

export async function fetchFabricaClientes(): Promise<FabricaCliente[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-clientes`, { credentials: "include" });
  const data = await tratarResposta<{ clientes: FabricaCliente[] }>(res);
  return data.clientes;
}

export async function criarFabricaCliente(entrada: FabricaClienteEntrada): Promise<{ id: number }> {
  const res = await fetch(`${API_BASE}/api/fabrica-clientes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  return tratarResposta<{ id: number }>(res);
}

export async function atualizarFabricaCliente(id: number, entrada: FabricaClienteEntrada): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-clientes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  await semConteudo(res);
}

export async function excluirFabricaCliente(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-clientes/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await semConteudo(res);
}
