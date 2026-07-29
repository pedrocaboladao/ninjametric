import type { Empacotador, ItemRanking, LancamentoDia, HistoricoDia } from "../types/empacotadores";

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

export async function fetchEmpacotadores(): Promise<Empacotador[]> {
  const data = await chamar<{ empacotadores: Empacotador[] }>("/api/empacotadores");
  return data.empacotadores;
}

export async function criarEmpacotador(numero: number, nome: string): Promise<Empacotador> {
  return chamar("/api/empacotadores", { method: "POST", body: JSON.stringify({ numero, nome }) });
}

export async function atualizarEmpacotador(id: number, dados: { numero?: number; nome?: string }): Promise<void> {
  await chamar(`/api/empacotadores/${id}`, { method: "PATCH", body: JSON.stringify(dados) });
}

export async function excluirEmpacotador(id: number): Promise<void> {
  await chamar(`/api/empacotadores/${id}`, { method: "DELETE" });
}

export async function fetchLancamentosDoDia(data: string): Promise<LancamentoDia[]> {
  const res = await chamar<{ lancamentos: LancamentoDia[] }>(
    `/api/empacotadores/lancamentos?data=${encodeURIComponent(data)}`
  );
  return res.lancamentos;
}

export async function salvarLancamentos(
  data: string,
  itens: { empacotadorId: number; pacotes: number }[]
): Promise<void> {
  await chamar("/api/empacotadores/lancamentos", { method: "POST", body: JSON.stringify({ data, itens }) });
}

export async function fetchRankingMensal(ano: number, mes: number): Promise<ItemRanking[]> {
  const res = await chamar<{ ranking: ItemRanking[] }>(`/api/empacotadores/ranking?ano=${ano}&mes=${mes}`);
  return res.ranking;
}

export async function fetchHistoricoEmpacotador(id: number, ano: number, mes: number): Promise<HistoricoDia[]> {
  const res = await chamar<{ historico: HistoricoDia[] }>(`/api/empacotadores/${id}/historico?ano=${ano}&mes=${mes}`);
  return res.historico;
}
