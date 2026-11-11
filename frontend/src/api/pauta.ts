import type { PautaItem } from "../types/pauta";

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

export async function fetchPauta(): Promise<PautaItem[]> {
  const data = await chamar<{ itens: PautaItem[] }>("/api/pauta");
  return data.itens;
}

export async function criarItemPauta(dados: {
  titulo: string;
  descricao?: string | null;
  lojaId?: number | null;
  area?: string | null;
}): Promise<PautaItem> {
  return chamar("/api/pauta", { method: "POST", body: JSON.stringify(dados) });
}

export async function apoiarItem(id: number): Promise<void> {
  await chamar(`/api/pauta/${id}/apoiar`, { method: "POST" });
}

export async function desapoiarItem(id: number): Promise<void> {
  await chamar(`/api/pauta/${id}/apoiar`, { method: "DELETE" });
}

export async function selecionarParaReuniao(id: number, reuniaoData: string): Promise<void> {
  await chamar(`/api/pauta/${id}/selecionar`, { method: "POST", body: JSON.stringify({ reuniaoData }) });
}

export async function marcarDiscutido(id: number, decisao: string | null): Promise<void> {
  await chamar(`/api/pauta/${id}/discutido`, { method: "POST", body: JSON.stringify({ decisao }) });
}

export async function adiarItem(id: number): Promise<void> {
  await chamar(`/api/pauta/${id}/adiar`, { method: "POST" });
}

export async function excluirItemPauta(id: number): Promise<void> {
  await chamar(`/api/pauta/${id}`, { method: "DELETE" });
}
