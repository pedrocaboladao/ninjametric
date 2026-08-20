import type {
  FabricaEmbalagem,
  FabricaEmbalagemEntrada,
  VinculoEmbalagem,
  MovimentoEmbalagem,
} from "../types/fabricaEmbalagens";

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

export async function fetchFabricaEmbalagens(): Promise<FabricaEmbalagem[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-embalagens`, { credentials: "include" });
  const data = await tratarResposta<{ embalagens: FabricaEmbalagem[] }>(res);
  return data.embalagens;
}

export async function criarFabricaEmbalagem(e: FabricaEmbalagemEntrada): Promise<{ id: number }> {
  const res = await fetch(`${API_BASE}/api/fabrica-embalagens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(e),
  });
  return tratarResposta<{ id: number }>(res);
}

export async function atualizarFabricaEmbalagem(id: number, e: FabricaEmbalagemEntrada): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-embalagens/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(e),
  });
  await semConteudo(res);
}

export async function excluirFabricaEmbalagem(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-embalagens/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await semConteudo(res);
}

export async function fetchVinculosEmbalagem(): Promise<VinculoEmbalagem[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-embalagens/formulas/vinculos`, {
    credentials: "include",
  });
  const data = await tratarResposta<{ vinculos: VinculoEmbalagem[] }>(res);
  return data.vinculos;
}

export async function ligarVinculoEmbalagem(id: number, fabricaEmbalagemId: number | null): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-embalagens/formulas/vinculos/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ fabricaEmbalagemId }),
  });
  await semConteudo(res);
}

export async function vincularPorPeso(): Promise<{ ligadas: number; ambiguas: number }> {
  const res = await fetch(`${API_BASE}/api/fabrica-embalagens/formulas/vincular-por-peso`, {
    method: "POST",
    credentials: "include",
  });
  return tratarResposta<{ ligadas: number; ambiguas: number }>(res);
}

// --- compras e ajustes -------------------------------------------------------

export async function fetchComprasEmbalagem(): Promise<MovimentoEmbalagem[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-embalagens/compras`, { credentials: "include" });
  return (await tratarResposta<{ compras: MovimentoEmbalagem[] }>(res)).compras;
}

export async function registrarCompraEmbalagem(entrada: {
  embalagemId: number;
  quantidade: number;
  custoUnitario: number;
  data?: string | null;
  observacao?: string | null;
}): Promise<{ id: number }> {
  const res = await fetch(`${API_BASE}/api/fabrica-embalagens/compras`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  return tratarResposta<{ id: number }>(res);
}

export async function excluirCompraEmbalagem(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-embalagens/compras/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await semConteudo(res);
}

export async function fetchAjustesEmbalagem(): Promise<MovimentoEmbalagem[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-embalagens/ajustes`, { credentials: "include" });
  return (await tratarResposta<{ ajustes: MovimentoEmbalagem[] }>(res)).ajustes;
}

export async function registrarAjusteEmbalagem(entrada: {
  embalagemId: number;
  tipo: "ajuste" | "inventario";
  quantidade?: number;
  contado?: number;
  motivo?: string | null;
}): Promise<{ id: number; diferenca?: number }> {
  const res = await fetch(`${API_BASE}/api/fabrica-embalagens/ajustes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  return tratarResposta<{ id: number; diferenca?: number }>(res);
}

export async function excluirAjusteEmbalagem(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-embalagens/ajustes/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await semConteudo(res);
}
