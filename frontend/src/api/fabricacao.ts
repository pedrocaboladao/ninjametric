import type { MateriaPrima, FormulaResumo, Formula, DadosMlSku } from "../types/fabricacao";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function tratarResposta<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return res.json();
}

export async function fetchMateriasPrimas(): Promise<MateriaPrima[]> {
  const res = await fetch(`${API_BASE}/api/fabricacao/materias-primas`, { credentials: "include" });
  const data = await tratarResposta<{ materiasPrimas: MateriaPrima[] }>(res);
  return data.materiasPrimas;
}

export async function criarMateriaPrima(nome: string, custoPorKg: number): Promise<MateriaPrima> {
  const res = await fetch(`${API_BASE}/api/fabricacao/materias-primas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ nome, custoPorKg }),
  });
  return tratarResposta<MateriaPrima>(res);
}

export async function atualizarMateriaPrima(id: number, nome: string, custoPorKg: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabricacao/materias-primas/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ nome, custoPorKg }),
  });
  await tratarResposta(res);
}

export async function excluirMateriaPrima(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabricacao/materias-primas/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await tratarResposta(res);
}

export async function fetchFormulas(): Promise<FormulaResumo[]> {
  const res = await fetch(`${API_BASE}/api/fabricacao/formulas`, { credentials: "include" });
  const data = await tratarResposta<{ formulas: FormulaResumo[] }>(res);
  return data.formulas;
}

export async function fetchFormula(id: number): Promise<Formula> {
  const res = await fetch(`${API_BASE}/api/fabricacao/formulas/${id}`, { credentials: "include" });
  return tratarResposta<Formula>(res);
}

export interface FormulaEntrada {
  nome: string;
  sku: string | null;
  pesoLoteKg: number;
  custoEmbalagem: number;
  itens: { materiaPrimaId: number; percentual: number }[];
}

export async function criarFormula(entrada: FormulaEntrada): Promise<{ id: number }> {
  const res = await fetch(`${API_BASE}/api/fabricacao/formulas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  return tratarResposta<{ id: number }>(res);
}

export async function atualizarFormula(id: number, entrada: FormulaEntrada): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabricacao/formulas/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  await tratarResposta(res);
}

export async function excluirFormula(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabricacao/formulas/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await tratarResposta(res);
}

export async function fetchDadosMl(formulaId: number, lojaFiltro: number | "todas" | "minhas"): Promise<DadosMlSku> {
  const params = new URLSearchParams({ lojaId: String(lojaFiltro) });
  const res = await fetch(`${API_BASE}/api/fabricacao/formulas/${formulaId}/dados-ml?${params}`, {
    credentials: "include",
  });
  return tratarResposta<DadosMlSku>(res);
}
