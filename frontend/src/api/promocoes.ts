import type {
  Campanha,
  ResultadoCriarCampanha,
  RegistroExistenteEntrada,
  ResultadoRegistroLinha,
  ProgressoDescoberta,
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
