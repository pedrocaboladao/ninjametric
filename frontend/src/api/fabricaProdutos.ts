import type {
  FabricaProduto,
  FabricaProdutoEntrada,
  ResultadoImportacaoCatalogo,
  ConferenciaCatalogo,
} from "../types/fabricaProdutos";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function tratarResposta<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return res.json();
}

export async function fetchFabricaProdutos(): Promise<FabricaProduto[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-produtos`, { credentials: "include" });
  const data = await tratarResposta<{ produtos: FabricaProduto[] }>(res);
  return data.produtos;
}

export async function criarFabricaProduto(entrada: FabricaProdutoEntrada): Promise<{ id: number }> {
  const res = await fetch(`${API_BASE}/api/fabrica-produtos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  return tratarResposta<{ id: number }>(res);
}

export async function atualizarFabricaProduto(id: number, entrada: FabricaProdutoEntrada): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-produtos/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
}

export async function excluirFabricaProduto(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-produtos/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
}

// Traz os produtos de revenda do catálogo do Mercado Livre. Leitura pura: a
// planilha do Google Sheets não é tocada, e SKU já existente não é
// sobrescrito.
export async function importarCatalogo(): Promise<ResultadoImportacaoCatalogo> {
  const res = await fetch(`${API_BASE}/api/fabrica-produtos/importar-catalogo`, {
    method: "POST",
    credentials: "include",
  });
  return tratarResposta<ResultadoImportacaoCatalogo>(res);
}

// O que mudou de preço na planilha. Só consulta — aplicar é outra chamada.
export async function conferirPrecos(): Promise<ConferenciaCatalogo> {
  const res = await fetch(`${API_BASE}/api/fabrica-produtos/conferir-precos`, {
    credentials: "include",
  });
  return tratarResposta<ConferenciaCatalogo>(res);
}

export async function aplicarPrecos(ids: number[]): Promise<{ atualizados: number }> {
  const res = await fetch(`${API_BASE}/api/fabrica-produtos/aplicar-precos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ids }),
  });
  return tratarResposta<{ atualizados: number }>(res);
}
