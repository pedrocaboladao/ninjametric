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

// Baixa o catalogo em .xlsx. Nao usa <a download> apontando pra rota: o
// arquivo exige sessao, e o link solto nao manda o cookie. Busca com
// credentials e entrega o blob pro navegador salvar.
export async function baixarCatalogo(
  origem?: "FABRICA" | "DISTRIBUIDORA",
  somenteAtivos = false
): Promise<void> {
  const q = new URLSearchParams();
  if (origem) q.set("origem", origem);
  if (somenteAtivos) q.set("ativos", "1");
  const res = await fetch(`${API_BASE}/api/fabrica-produtos/exportar?${q}`, {
    credentials: "include",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "Falha ao exportar o catálogo.");
  }
  const nome =
    res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ??
    "catalogo.xlsx";
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // o revoke imediato cancela o download em alguns navegadores
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Sincroniza o cadastro com a PLANILHA OFICIAL FABRICA, que o usuário sobe na
// hora. Sem `aplicar`, é simulação: conta e lista o que mudaria sem gravar.
export interface SincronizacaoOuro {
  simulacao: boolean;
  naPlanilha: number;
  criados: number;
  atualizados: number;
  jaIguais: number;
  foraDaPlanilha: number;
  mudancas: { sku: string; campo: string; de: unknown; para: unknown }[];
  criadosSkus: string[];
}

export async function sincronizarOuro(
  arquivo: File,
  aplicar: boolean
): Promise<SincronizacaoOuro> {
  const corpo = new FormData();
  corpo.append("arquivo", arquivo);
  corpo.append("simular", aplicar ? "false" : "true");
  const res = await fetch(`${API_BASE}/api/fabrica-produtos/sincronizar-ouro`, {
    method: "POST",
    credentials: "include",
    body: corpo,
  });
  return tratarResposta<SincronizacaoOuro>(res);
}

// Recadastro do zero: cada SKU da planilha entra como registro novo. O registro
// antigo sai do cadastro quando nunca vendeu, e fica inativo quando vendeu.
export interface RecadastroOuro {
  simulacao: boolean;
  naPlanilha: number;
  duplicadosNaPlanilha: number;
  criados: number;
  removidos: number;
  arquivados: number;
  foraRemovidos: number;
  foraInativos: number;
  apelidosPerdidos: number;
  intocados: number;
  eanHerdado: number;
  semEan: number;
  arquivadosAmostra: string[];
  foraInativosAmostra: string[];
}

export async function recadastrarOuro(arquivo: File, aplicar: boolean): Promise<RecadastroOuro> {
  const corpo = new FormData();
  corpo.append("arquivo", arquivo);
  corpo.append("simular", aplicar ? "false" : "true");
  const res = await fetch(`${API_BASE}/api/fabrica-produtos/recadastrar-ouro`, {
    method: "POST",
    credentials: "include",
    body: corpo,
  });
  return tratarResposta<RecadastroOuro>(res);
}
