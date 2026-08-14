import type {
  PesquisaCategoria,
  PesquisaRankingLinha,
  PesquisaEvolucao,
  ResumoImportacaoPlanilha,
  PesquisaAnuncio,
} from "../types/pesquisa";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function tratarResposta<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return res.json();
}

export async function fetchCategorias(): Promise<PesquisaCategoria[]> {
  const res = await fetch(`${API_BASE}/api/pesquisa/categorias`, { credentials: "include" });
  const data = await tratarResposta<{ categorias: PesquisaCategoria[] }>(res);
  return data.categorias;
}

export async function criarCategoria(nome: string): Promise<PesquisaCategoria> {
  const res = await fetch(`${API_BASE}/api/pesquisa/categorias`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ nome }),
  });
  return tratarResposta<PesquisaCategoria>(res);
}

export async function excluirCategoria(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/pesquisa/categorias/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await tratarResposta(res);
}

export async function fetchMeses(categoriaId: number): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/pesquisa/categorias/${categoriaId}/meses`, { credentials: "include" });
  const data = await tratarResposta<{ meses: string[] }>(res);
  return data.meses;
}

export async function fetchRanking(categoriaId: number, mes: string): Promise<PesquisaRankingLinha[]> {
  const params = new URLSearchParams({ mes });
  const res = await fetch(`${API_BASE}/api/pesquisa/categorias/${categoriaId}/ranking?${params}`, {
    credentials: "include",
  });
  const data = await tratarResposta<{ ranking: PesquisaRankingLinha[] }>(res);
  return data.ranking;
}

export interface LancamentoEntrada {
  vendedor: string;
  qtde: number;
  totalReais: number;
}

export async function salvarLancamentosDoMes(categoriaId: number, mes: string, linhas: LancamentoEntrada[]): Promise<void> {
  const res = await fetch(`${API_BASE}/api/pesquisa/categorias/${categoriaId}/lancamentos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ mes, linhas }),
  });
  await tratarResposta(res);
}

export async function excluirLancamento(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/pesquisa/lancamentos/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await tratarResposta(res);
}

export async function fetchEvolucao(categoriaId: number): Promise<PesquisaEvolucao> {
  const res = await fetch(`${API_BASE}/api/pesquisa/categorias/${categoriaId}/evolucao`, { credentials: "include" });
  return tratarResposta<PesquisaEvolucao>(res);
}

export async function importarPlanilha(arquivo: File): Promise<ResumoImportacaoPlanilha[]> {
  const formData = new FormData();
  formData.append("arquivo", arquivo);
  const res = await fetch(`${API_BASE}/api/pesquisa/importar-planilha`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  const data = await tratarResposta<{ resumo: ResumoImportacaoPlanilha[] }>(res);
  return data.resumo;
}

export async function importarAnuncios(categoriaId: number, data: string, arquivo: File): Promise<{ linhas: number }> {
  const formData = new FormData();
  formData.append("data", data);
  formData.append("arquivo", arquivo);
  const res = await fetch(`${API_BASE}/api/pesquisa/categorias/${categoriaId}/anuncios/importar`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  return tratarResposta<{ linhas: number }>(res);
}

export async function fetchSnapshotsAnuncios(categoriaId: number): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/pesquisa/categorias/${categoriaId}/anuncios/snapshots`, {
    credentials: "include",
  });
  const data = await tratarResposta<{ snapshots: string[] }>(res);
  return data.snapshots;
}

export async function fetchAnuncios(categoriaId: number, data: string, vendedor: string): Promise<PesquisaAnuncio[]> {
  const params = new URLSearchParams({ data });
  if (vendedor.trim()) params.set("vendedor", vendedor.trim());
  const res = await fetch(`${API_BASE}/api/pesquisa/categorias/${categoriaId}/anuncios?${params}`, {
    credentials: "include",
  });
  const dataResp = await tratarResposta<{ anuncios: PesquisaAnuncio[] }>(res);
  return dataResp.anuncios;
}
