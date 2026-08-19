const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function tratarResposta<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return res.json();
}

export interface Keyword {
  id: number;
  keyword: string;
  active: boolean;
  createdAt: string;
  lastCollectedAt: string | null;
}

export interface SnapshotRow {
  collectedAt: string;
  position: number;
  itemId: string;
  title: string | null;
  sellerName: string | null;
  price: number | null;
  isOwnListing: boolean;
  ownStoreName: string | null;
}

export interface MetricasKeyword {
  ultimaColeta: string | null;
  precoMedioAtual: number | null;
  melhorPosicaoPropria: number | null;
}

export interface HistoricoKeyword {
  historico: SnapshotRow[];
  metricas: MetricasKeyword;
}

export async function listarKeywords(): Promise<Keyword[]> {
  const res = await fetch(`${API_BASE}/api/market-intelligence/keywords`, { credentials: "include" });
  const data = await tratarResposta<{ keywords: Keyword[] }>(res);
  return data.keywords;
}

export async function criarKeyword(keyword: string): Promise<Keyword> {
  const res = await fetch(`${API_BASE}/api/market-intelligence/keywords`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ keyword }),
  });
  const data = await tratarResposta<{ keyword: Keyword }>(res);
  return data.keyword;
}

export async function definirKeywordAtiva(id: number, active: boolean): Promise<void> {
  const res = await fetch(`${API_BASE}/api/market-intelligence/keywords/${id}/active`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ active }),
  });
  await tratarResposta(res);
}

export async function buscarKeywordAgora(id: number): Promise<HistoricoKeyword> {
  const res = await fetch(`${API_BASE}/api/market-intelligence/keywords/${id}/search`, {
    method: "POST",
    credentials: "include",
  });
  return tratarResposta<HistoricoKeyword>(res);
}

export async function historicoKeyword(id: number): Promise<HistoricoKeyword> {
  const res = await fetch(`${API_BASE}/api/market-intelligence/keywords/${id}/history`, {
    credentials: "include",
  });
  return tratarResposta<HistoricoKeyword>(res);
}

export interface CategoriaDisponivel {
  categoryId: string;
  nome: string | null;
  total: number;
}

export interface ShareMercado {
  categoriaId: string | null;
  categoriaNome: string | null;
  totalResultados: number;
  resultadosProprios: number;
  shareSimples: number;
  sharePonderado: number;
  lojasContribuintes: string[];
}

export interface ShareKeyword {
  share: ShareMercado | null;
  categoriasDisponiveis: CategoriaDisponivel[];
}

export async function buscarShareMercado(id: number, categoryId?: string): Promise<ShareKeyword> {
  const params = categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : "";
  const res = await fetch(`${API_BASE}/api/market-intelligence/keywords/${id}/share${params}`, {
    credentials: "include",
  });
  return tratarResposta<ShareKeyword>(res);
}
