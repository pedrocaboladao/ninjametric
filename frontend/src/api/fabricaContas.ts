import type {
  Conta,
  ContaEntrada,
  ResumoContas,
  StatusConta,
  TipoConta,
} from "../types/fabricaContas";

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

function query(filtro: { tipo?: TipoConta; status?: StatusConta; de?: string; ate?: string }) {
  const q = new URLSearchParams();
  if (filtro.tipo) q.set("tipo", filtro.tipo);
  if (filtro.status) q.set("status", filtro.status);
  if (filtro.de) q.set("de", filtro.de);
  if (filtro.ate) q.set("ate", filtro.ate);
  return q.toString();
}

export async function fetchContas(filtro: {
  tipo?: TipoConta;
  status?: StatusConta;
  de?: string;
  ate?: string;
  limite?: number;
} = {}): Promise<Conta[]> {
  // Pede o mes inteiro, nao as 300 mais recentes.
  //
  // O servidor devolvia 300 por padrao e a tela somava o que chegava — um total
  // que parecia o total. Com lancamento recorrente ate 2027, as 300 mais novas
  // sao as do futuro, e o mes que o operador esta olhando ficava de fora.
  const res = await fetch(
    `${API_BASE}/api/fabrica-contas?${query({ limite: 5000, ...filtro })}`,
    { credentials: "include" }
  );
  return (await tratarResposta<{ contas: Conta[] }>(res)).contas;
}

export async function fetchResumoContas(filtro: { de?: string; ate?: string } = {}): Promise<ResumoContas> {
  const res = await fetch(`${API_BASE}/api/fabrica-contas/resumo?${query(filtro)}`, {
    credentials: "include",
  });
  return (await tratarResposta<{ resumo: ResumoContas }>(res)).resumo;
}

export async function criarConta(entrada: ContaEntrada): Promise<{ ids: number[] }> {
  const res = await fetch(`${API_BASE}/api/fabrica-contas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  return tratarResposta<{ ids: number[] }>(res);
}

export async function atualizarConta(id: number, entrada: ContaEntrada): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-contas/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  await semConteudo(res);
}

export async function definirStatusConta(
  id: number,
  status: StatusConta,
  dataPagamento?: string | null
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-contas/${id}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ status, dataPagamento: dataPagamento ?? null }),
  });
  await semConteudo(res);
}

export async function excluirConta(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-contas/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await semConteudo(res);
}

// --- anexos ------------------------------------------------------------------

export interface AnexoConta {
  id: number;
  contaId: number;
  nome: string;
  tipo: string;
  tamanho: number;
  criadoEm: string;
}

export async function listarAnexos(contaId: number): Promise<AnexoConta[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-contas/${contaId}/anexos`, {
    credentials: "include",
  });
  const r = await tratarResposta<{ anexos: AnexoConta[] }>(res);
  return r.anexos;
}

export async function enviarAnexo(contaId: number, arquivo: File): Promise<AnexoConta> {
  const corpo = new FormData();
  corpo.append("arquivo", arquivo);
  const res = await fetch(`${API_BASE}/api/fabrica-contas/${contaId}/anexos`, {
    method: "POST",
    credentials: "include",
    body: corpo,
  });
  return tratarResposta<AnexoConta>(res);
}

export async function excluirAnexo(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-contas/anexos/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await semConteudo(res);
}

// Abre numa aba nova. PDF e imagem o navegador mostra; o resto ele baixa.
export function urlDoAnexo(id: number): string {
  return `${API_BASE}/api/fabrica-contas/anexos/${id}`;
}
