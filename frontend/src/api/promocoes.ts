import type {
  Campanha,
  ResultadoCriarCampanha,
  RegistroExistenteEntrada,
  ResultadoRegistroLinha,
  ProgressoDescoberta,
  Oportunidade,
  ProgressoBuscaOportunidades,
  ComparacaoOportunidade,
  ResultadoAprovacaoLote,
} from "../types/promocoes";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function tratarResposta<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return res.json();
}

export async function fetchCampanhas(lojaFiltro: number | "todas" | "minhas"): Promise<Campanha[]> {
  const params = new URLSearchParams({ lojaId: String(lojaFiltro) });
  const res = await fetch(`${API_BASE}/api/promocoes?${params}`, { credentials: "include" });
  const data = await tratarResposta<{ campanhas: Campanha[] }>(res);
  return data.campanhas;
}

export async function criarCampanha(
  lojaId: number,
  nome: string,
  percentual: number,
  itemIds: string[]
): Promise<ResultadoCriarCampanha> {
  const res = await fetch(`${API_BASE}/api/promocoes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ lojaId, nome, percentual, itemIds }),
  });
  return tratarResposta<ResultadoCriarCampanha>(res);
}

export async function recriarCampanha(id: number): Promise<ResultadoCriarCampanha> {
  const res = await fetch(`${API_BASE}/api/promocoes/${id}/recriar`, {
    method: "POST",
    credentials: "include",
  });
  return tratarResposta<ResultadoCriarCampanha>(res);
}

export async function registrarCampanhasExistentes(registros: RegistroExistenteEntrada[]): Promise<ResultadoRegistroLinha[]> {
  const res = await fetch(`${API_BASE}/api/promocoes/registrar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ registros }),
  });
  const data = await tratarResposta<{ resultados: ResultadoRegistroLinha[] }>(res);
  return data.resultados;
}

export async function iniciarDescoberta(lojaFiltro: number | "todas" | "minhas"): Promise<void> {
  const params = new URLSearchParams({ lojaId: String(lojaFiltro) });
  const res = await fetch(`${API_BASE}/api/promocoes/descobrir?${params}`, {
    method: "POST",
    credentials: "include",
  });
  await tratarResposta(res);
}

export async function fetchProgressoDescoberta(): Promise<ProgressoDescoberta> {
  const res = await fetch(`${API_BASE}/api/promocoes/descobrir/status`, { credentials: "include" });
  return tratarResposta<ProgressoDescoberta>(res);
}

export async function excluirCampanha(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/promocoes/${id}`, { method: "DELETE", credentials: "include" });
  await tratarResposta(res);
}

export async function limparCampanhas(lojaFiltro: number | "todas" | "minhas"): Promise<number> {
  const params = new URLSearchParams({ lojaId: String(lojaFiltro) });
  const res = await fetch(`${API_BASE}/api/promocoes?${params}`, { method: "DELETE", credentials: "include" });
  const data = await tratarResposta<{ apagadas: number }>(res);
  return data.apagadas;
}

export async function iniciarBuscaOportunidades(lojaFiltro: number | "todas" | "minhas"): Promise<void> {
  const params = new URLSearchParams({ lojaId: String(lojaFiltro) });
  const res = await fetch(`${API_BASE}/api/promocoes/oportunidades/buscar?${params}`, {
    method: "POST",
    credentials: "include",
  });
  await tratarResposta(res);
}

export async function fetchProgressoBuscaOportunidades(): Promise<ProgressoBuscaOportunidades> {
  const res = await fetch(`${API_BASE}/api/promocoes/oportunidades/buscar/status`, { credentials: "include" });
  return tratarResposta<ProgressoBuscaOportunidades>(res);
}

export async function fetchOportunidades(lojaFiltro: number | "todas" | "minhas"): Promise<Oportunidade[]> {
  const params = new URLSearchParams({ lojaId: String(lojaFiltro) });
  const res = await fetch(`${API_BASE}/api/promocoes/oportunidades?${params}`, { credentials: "include" });
  const data = await tratarResposta<{ oportunidades: Oportunidade[] }>(res);
  return data.oportunidades;
}

export async function aprovarOportunidade(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/promocoes/oportunidades/${id}/aprovar`, {
    method: "POST",
    credentials: "include",
  });
  await tratarResposta(res);
}

export async function aprovarVariasOportunidades(ids: number[]): Promise<ResultadoAprovacaoLote[]> {
  const res = await fetch(`${API_BASE}/api/promocoes/oportunidades/aprovar-varias`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ids }),
  });
  const data = await tratarResposta<{ resultados: ResultadoAprovacaoLote[] }>(res);
  return data.resultados;
}

export async function rejeitarOportunidade(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/promocoes/oportunidades/${id}/rejeitar`, {
    method: "POST",
    credentials: "include",
  });
  await tratarResposta(res);
}

export async function compararComVendaReal(id: number): Promise<ComparacaoOportunidade> {
  const res = await fetch(`${API_BASE}/api/promocoes/oportunidades/${id}/comparar`, { credentials: "include" });
  return tratarResposta<ComparacaoOportunidade>(res);
}

export async function limparOportunidades(lojaFiltro: number | "todas" | "minhas"): Promise<number> {
  const params = new URLSearchParams({ lojaId: String(lojaFiltro) });
  const res = await fetch(`${API_BASE}/api/promocoes/oportunidades?${params}`, { method: "DELETE", credentials: "include" });
  const data = await tratarResposta<{ apagadas: number }>(res);
  return data.apagadas;
}
