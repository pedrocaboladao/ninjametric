import type {
  Lancamento,
  ResumoContas,
  NovoLancamentoInput,
  NovoLancamentoParceladoInput,
  EdicaoLancamentoInput,
  Contato,
  TipoContato,
  NovoContatoInput,
  EdicaoContatoInput,
} from "../types/contas";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export interface FiltrosLancamentos {
  lojaFiltro: number | "todas" | "minhas";
  tipo?: string;
  status?: string;
  dataInicio?: string;
  dataFim?: string;
}

async function tratarResposta<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return res.json();
}

function montarParams(f: FiltrosLancamentos): URLSearchParams {
  const params = new URLSearchParams({ lojaId: String(f.lojaFiltro) });
  if (f.tipo) params.set("tipo", f.tipo);
  if (f.status) params.set("status", f.status);
  if (f.dataInicio) params.set("dataInicio", f.dataInicio);
  if (f.dataFim) params.set("dataFim", f.dataFim);
  return params;
}

export async function fetchLancamentos(f: FiltrosLancamentos): Promise<Lancamento[]> {
  const res = await fetch(`${API_BASE}/api/contas?${montarParams(f)}`, { credentials: "include" });
  return tratarResposta(res);
}

export async function fetchResumoContas(f: FiltrosLancamentos): Promise<ResumoContas> {
  const res = await fetch(`${API_BASE}/api/contas/resumo?${montarParams(f)}`, { credentials: "include" });
  return tratarResposta(res);
}

export async function criarLancamento(dados: NovoLancamentoInput): Promise<Lancamento> {
  const res = await fetch(`${API_BASE}/api/contas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(dados),
  });
  return tratarResposta(res);
}

export async function atualizarLancamento(id: number, dados: EdicaoLancamentoInput): Promise<Lancamento> {
  const res = await fetch(`${API_BASE}/api/contas/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(dados),
  });
  return tratarResposta(res);
}

export async function marcarComoPago(id: number, dataPagamento?: string): Promise<Lancamento> {
  const res = await fetch(`${API_BASE}/api/contas/${id}/marcar-pago`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ dataPagamento }),
  });
  return tratarResposta(res);
}

export async function excluirLancamento(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/contas/${id}`, { method: "DELETE", credentials: "include" });
  await tratarResposta(res);
}

export async function criarLancamentoParcelado(dados: NovoLancamentoParceladoInput): Promise<Lancamento[]> {
  const res = await fetch(`${API_BASE}/api/contas/parcelado`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(dados),
  });
  return tratarResposta(res);
}

export async function fetchContatos(tipo?: TipoContato): Promise<Contato[]> {
  const params = new URLSearchParams();
  if (tipo) params.set("tipo", tipo);
  const query = params.toString() ? `?${params}` : "";
  const res = await fetch(`${API_BASE}/api/contas/contatos${query}`, { credentials: "include" });
  return tratarResposta(res);
}

export async function criarContato(dados: NovoContatoInput): Promise<Contato> {
  const res = await fetch(`${API_BASE}/api/contas/contatos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(dados),
  });
  return tratarResposta(res);
}

export async function atualizarContato(id: number, dados: EdicaoContatoInput): Promise<Contato> {
  const res = await fetch(`${API_BASE}/api/contas/contatos/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(dados),
  });
  return tratarResposta(res);
}

export async function excluirContato(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/contas/contatos/${id}`, { method: "DELETE", credentials: "include" });
  await tratarResposta(res);
}
