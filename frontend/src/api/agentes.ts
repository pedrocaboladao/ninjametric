import type { ObservacaoAds, PensamentoAds, MensagemChat, PerfilImagens } from "../types/agentes";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function tratarResposta<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return res.json();
}

export async function fetchFeedAds(status?: "pendente" | "resolvida"): Promise<ObservacaoAds[]> {
  const params = status ? `?status=${status}` : "";
  const res = await fetch(`${API_BASE}/api/agentes/ads/feed${params}`, { credentials: "include" });
  const data = await tratarResposta<{ observacoes: ObservacaoAds[] }>(res);
  return data.observacoes;
}

export async function verificarAgenteAdsAgora(): Promise<{ novas: number; resolvidasSozinhas: number }> {
  const res = await fetch(`${API_BASE}/api/agentes/ads/verificar`, { method: "POST", credentials: "include" });
  return tratarResposta(res);
}

export async function confirmarObservacaoAds(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agentes/ads/${id}/confirmar`, { method: "POST", credentials: "include" });
  await tratarResposta(res);
}

export async function fetchPensamentosAds(): Promise<PensamentoAds[]> {
  const res = await fetch(`${API_BASE}/api/agentes/ads/pensamentos`, { credentials: "include" });
  const data = await tratarResposta<{ pensamentos: PensamentoAds[] }>(res);
  return data.pensamentos;
}

export async function perguntarAgenteAds(pergunta: string, historico: MensagemChat[]): Promise<string> {
  const res = await fetch(`${API_BASE}/api/agentes/ads/perguntar`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pergunta, historico }),
  });
  const data = await tratarResposta<{ resposta: string }>(res);
  return data.resposta;
}

export async function tratarFotoProduto(imagemBase64: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/agentes/imagens/tratar-foto`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imagemBase64 }),
  });
  const data = await tratarResposta<{ imagemBase64: string }>(res);
  return data.imagemBase64;
}

export async function criarArtePromocional(descricao: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/agentes/imagens/criar-arte`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ descricao }),
  });
  const data = await tratarResposta<{ imagemBase64: string }>(res);
  return data.imagemBase64;
}

export interface DadosKitFotos {
  nomeProduto: string;
  subtitulo: string;
  cores: string;
  beneficios: string[];
  especificacaoPrincipal: string;
  specsSecundarias: string[];
  ondeAplicar: string[];
}

export async function gerarKitFotos(
  imagemBase64: string,
  dados: DadosKitFotos,
  imagemReferenciaBase64?: string
): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/agentes/imagens/kit`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imagemBase64, imagemReferenciaBase64, ...dados }),
  });
  const data = await tratarResposta<{ imagens: string[] }>(res);
  return data.imagens;
}

export async function fetchPerfisImagens(): Promise<PerfilImagens[]> {
  const res = await fetch(`${API_BASE}/api/agentes/imagens/perfis`, { credentials: "include" });
  const data = await tratarResposta<{ perfis: PerfilImagens[] }>(res);
  return data.perfis;
}

export async function criarPerfilImagens(dados: {
  nome: string;
  cores: string;
  imagemReferenciaBase64: string | null;
  beneficiosPadrao: string;
  ondeAplicarPadrao: string;
}): Promise<PerfilImagens> {
  const res = await fetch(`${API_BASE}/api/agentes/imagens/perfis`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados),
  });
  const data = await tratarResposta<{ perfil: PerfilImagens }>(res);
  return data.perfil;
}

export async function excluirPerfilImagens(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agentes/imagens/perfis/${id}`, { method: "DELETE", credentials: "include" });
  await tratarResposta(res);
}
