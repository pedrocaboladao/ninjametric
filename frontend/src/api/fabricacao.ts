import type {
  MateriaPrima,
  MateriaPrimaCompra,
  FormulaResumo,
  Formula,
  FormulaLote,
  DadosMlSku,
} from "../types/fabricacao";

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

export async function fetchComprasMateriaPrima(materiaPrimaId: number): Promise<MateriaPrimaCompra[]> {
  const res = await fetch(`${API_BASE}/api/fabricacao/materias-primas/${materiaPrimaId}/compras`, {
    credentials: "include",
  });
  const data = await tratarResposta<{ compras: MateriaPrimaCompra[] }>(res);
  return data.compras;
}

export async function registrarCompraMateriaPrima(
  materiaPrimaId: number,
  data: string,
  quantidadeKg: number,
  valorPago: number,
  valorFrete: number
): Promise<MateriaPrimaCompra> {
  const res = await fetch(`${API_BASE}/api/fabricacao/materias-primas/${materiaPrimaId}/compras`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ data, quantidadeKg, valorPago, valorFrete }),
  });
  return tratarResposta<MateriaPrimaCompra>(res);
}

export async function atualizarCompraMateriaPrima(
  materiaPrimaId: number,
  compraId: number,
  data: string,
  quantidadeKg: number,
  valorPago: number,
  valorFrete: number
): Promise<MateriaPrimaCompra> {
  const res = await fetch(`${API_BASE}/api/fabricacao/materias-primas/${materiaPrimaId}/compras/${compraId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ data, quantidadeKg, valorPago, valorFrete }),
  });
  return tratarResposta<MateriaPrimaCompra>(res);
}

export async function excluirCompraMateriaPrima(materiaPrimaId: number, compraId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabricacao/materias-primas/${materiaPrimaId}/compras/${compraId}`, {
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

export interface ItemEntrada {
  materiaPrimaId: number | null;
  subFormulaId: number | null;
  percentual: number;
}

export interface EmbalagemEntrada {
  nome: string;
  pesoKg: number;
  custoEmbalagem: number;
  sku: string | null;
}

export interface FormulaEntrada {
  nome: string;
  pesoLoteKg: number;
  itens: ItemEntrada[];
  embalagens: EmbalagemEntrada[];
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

export async function fetchLotes(formulaId: number): Promise<FormulaLote[]> {
  const res = await fetch(`${API_BASE}/api/fabricacao/formulas/${formulaId}/lotes`, { credentials: "include" });
  const data = await tratarResposta<{ lotes: FormulaLote[] }>(res);
  return data.lotes;
}

export async function registrarLote(
  formulaId: number,
  data: string,
  pesoRealKg: number,
  observacao: string | null
): Promise<FormulaLote> {
  const res = await fetch(`${API_BASE}/api/fabricacao/formulas/${formulaId}/lotes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ data, pesoRealKg, observacao }),
  });
  return tratarResposta<FormulaLote>(res);
}

export async function atualizarLote(
  formulaId: number,
  loteId: number,
  data: string,
  pesoRealKg: number,
  observacao: string | null
): Promise<FormulaLote> {
  const res = await fetch(`${API_BASE}/api/fabricacao/formulas/${formulaId}/lotes/${loteId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ data, pesoRealKg, observacao }),
  });
  return tratarResposta<FormulaLote>(res);
}

export async function excluirLote(formulaId: number, loteId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabricacao/formulas/${formulaId}/lotes/${loteId}`, {
    method: "DELETE",
    credentials: "include",
  });
  await tratarResposta(res);
}

export async function fetchDadosMl(
  formulaId: number,
  sku: string,
  lojaFiltro: number | "todas" | "minhas"
): Promise<DadosMlSku> {
  const params = new URLSearchParams({ sku, lojaId: String(lojaFiltro) });
  const res = await fetch(`${API_BASE}/api/fabricacao/formulas/${formulaId}/dados-ml?${params}`, {
    credentials: "include",
  });
  return tratarResposta<DadosMlSku>(res);
}
