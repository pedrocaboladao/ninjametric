import type { EstoqueMateriaPrima, AjusteEstoque, CapacidadeFormula } from "../types/fabricaEstoque";

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

export async function fetchEstoque(): Promise<EstoqueMateriaPrima[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-estoque`, { credentials: "include" });
  return (await tratarResposta<{ estoque: EstoqueMateriaPrima[] }>(res)).estoque;
}

export async function fetchCapacidade(): Promise<CapacidadeFormula[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-estoque/capacidade`, { credentials: "include" });
  return (await tratarResposta<{ capacidade: CapacidadeFormula[] }>(res)).capacidade;
}

export async function fetchAjustes(): Promise<AjusteEstoque[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-estoque/ajustes`, { credentials: "include" });
  return (await tratarResposta<{ ajustes: AjusteEstoque[] }>(res)).ajustes;
}

export async function definirEstoqueMinimo(id: number, estoqueMinimo: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-estoque/${id}/minimo`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ estoqueMinimo }),
  });
  await semConteudo(res);
}

export async function definirControlaEstoque(id: number, controlaEstoque: boolean): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-estoque/${id}/controla`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ controlaEstoque }),
  });
  await semConteudo(res);
}

export async function registrarAjuste(entrada: {
  materiaPrimaId: number;
  tipo: "ajuste" | "inventario";
  quantidadeKg?: number;
  contadoKg?: number;
  motivo?: string | null;
}): Promise<{ id: number; diferenca?: number }> {
  const res = await fetch(`${API_BASE}/api/fabrica-estoque/ajustes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  return tratarResposta<{ id: number; diferenca?: number }>(res);
}

export async function excluirAjuste(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-estoque/ajustes/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await semConteudo(res);
}
