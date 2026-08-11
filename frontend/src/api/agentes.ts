import type {
  PensamentoAds,
  MensagemChat,
  PerfilImagens,
  Oportunidade,
  PensamentoCatalogo,
  PensamentoConversao,
  PlanoDiario,
  ResumoEscritorio,
  BriefingGrowthHacker,
  VendaRecente,
} from "../types/agentes";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function tratarResposta<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return res.json();
}

export async function fetchVendasRecentes(): Promise<VendaRecente[]> {
  const res = await fetch(`${API_BASE}/api/agentes/vendas-recentes`, { credentials: "include" });
  const data = await tratarResposta<{ vendas: VendaRecente[] }>(res);
  return data.vendas;
}

export async function fetchResumoEscritorio(forcar = false): Promise<ResumoEscritorio> {
  const res = await fetch(`${API_BASE}/api/agentes/resumo-escritorio${forcar ? "?forcar=1" : ""}`, {
    credentials: "include",
  });
  return tratarResposta<ResumoEscritorio>(res);
}

export async function fetchPlanoDiario(): Promise<PlanoDiario[]> {
  const res = await fetch(`${API_BASE}/api/agentes/plano-diario`, { credentials: "include" });
  const data = await tratarResposta<{ pensamentos: PlanoDiario[] }>(res);
  return data.pensamentos;
}

export async function verificarPlanoDiarioAgora(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agentes/plano-diario/verificar`, { method: "POST", credentials: "include" });
  await tratarResposta(res);
}

export async function marcarItemPlano(id: number, concluido: boolean): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agentes/plano-diario/itens/${id}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ concluido }),
  });
  await tratarResposta(res);
}

export async function fetchOportunidades(): Promise<Oportunidade[]> {
  const res = await fetch(`${API_BASE}/api/agentes/oportunidades`, { credentials: "include" });
  const data = await tratarResposta<{ oportunidades: Oportunidade[] }>(res);
  return data.oportunidades;
}

export async function verificarOportunidadesAgora(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agentes/oportunidades/verificar`, { method: "POST", credentials: "include" });
  await tratarResposta(res);
}

export async function fetchPensamentosConversao(): Promise<PensamentoConversao[]> {
  const res = await fetch(`${API_BASE}/api/agentes/conversao/pensamentos`, { credentials: "include" });
  const data = await tratarResposta<{ pensamentos: PensamentoConversao[] }>(res);
  return data.pensamentos;
}

export async function fetchPensamentosCatalogo(): Promise<PensamentoCatalogo[]> {
  const res = await fetch(`${API_BASE}/api/agentes/catalogo/pensamentos`, { credentials: "include" });
  const data = await tratarResposta<{ pensamentos: PensamentoCatalogo[] }>(res);
  return data.pensamentos;
}

export async function fetchPensamentosAds(): Promise<PensamentoAds[]> {
  const res = await fetch(`${API_BASE}/api/agentes/ads/pensamentos`, { credentials: "include" });
  const data = await tratarResposta<{ pensamentos: PensamentoAds[] }>(res);
  return data.pensamentos;
}

export interface RespostaChatAgente {
  resposta: string;
  pensamento: string | null;
}

export async function perguntarGrowthHacker(pergunta: string, historico: MensagemChat[]): Promise<RespostaChatAgente> {
  const res = await fetch(`${API_BASE}/api/agentes/ads/perguntar`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pergunta, historico }),
  });
  return tratarResposta<RespostaChatAgente>(res);
}

export async function perguntarDiretorAds(
  pergunta: string,
  historico: MensagemChat[],
  lojaId?: number
): Promise<RespostaChatAgente> {
  const res = await fetch(`${API_BASE}/api/agentes/diretor-ads/perguntar`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pergunta, historico, lojaId }),
  });
  return tratarResposta<RespostaChatAgente>(res);
}

export async function fetchBriefingsGrowthHacker(): Promise<BriefingGrowthHacker[]> {
  const res = await fetch(`${API_BASE}/api/agentes/growth-hacker/feed`, { credentials: "include" });
  const data = await tratarResposta<{ pensamentos: BriefingGrowthHacker[] }>(res);
  return data.pensamentos;
}

export async function verificarBriefingGrowthHackerAgora(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agentes/growth-hacker/verificar`, {
    method: "POST",
    credentials: "include",
  });
  await tratarResposta(res);
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

export async function criarArtePromocional(descricao: string, imagensReferenciaBase64?: string[]): Promise<string> {
  const res = await fetch(`${API_BASE}/api/agentes/imagens/criar-arte`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ descricao, imagensReferenciaBase64 }),
  });
  const data = await tratarResposta<{ imagemBase64: string }>(res);
  return data.imagemBase64;
}

export interface DadosAnuncioParaKit {
  titulo: string;
  fotoBase64: string | null;
  subtitulo: string;
  beneficios: string[];
  especificacaoPrincipal: string;
  specsSecundarias: string[];
  ondeAplicar: string[];
}

export async function buscarDadosAnuncio(url: string): Promise<DadosAnuncioParaKit> {
  const res = await fetch(`${API_BASE}/api/agentes/imagens/buscar-anuncio`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return tratarResposta<DadosAnuncioParaKit>(res);
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

export interface SugestaoOriginalKit {
  subtitulo: string;
  beneficios: string[];
  especificacaoPrincipal: string;
  specsSecundarias: string[];
  ondeAplicar: string[];
}

export async function gerarKitFotos(
  imagemBase64: string,
  dados: DadosKitFotos,
  imagensReferenciaBase64?: string[],
  sugestaoOriginal?: SugestaoOriginalKit
): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/agentes/imagens/kit`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imagemBase64, imagensReferenciaBase64, sugestaoOriginal, ...dados }),
  });
  const data = await tratarResposta<{ imagens: string[] }>(res);
  return data.imagens;
}

export async function fetchReferenciasPerfil(perfilId: number): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/agentes/imagens/perfis/${perfilId}/referencias`, { credentials: "include" });
  const data = await tratarResposta<{ referencias: string[] }>(res);
  return data.referencias;
}

export async function favoritarReferenciaPerfil(perfilId: number, imagemBase64: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agentes/imagens/perfis/${perfilId}/referencias`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imagemBase64 }),
  });
  await tratarResposta(res);
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
