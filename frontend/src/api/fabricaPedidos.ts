import type {
  Pedido,
  PedidoEntrada,
  StatusPedido,
  EstoqueProduto,
  AjusteProduto,
  ContaCorrente,
  Pagamento,
  LinhaExtrato,
} from "../types/fabricaPedidos";

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

export async function fetchPedidos(filtro: {
  clienteId?: number;
  status?: StatusPedido;
  de?: string;
  ate?: string;
} = {}): Promise<Pedido[]> {
  const q = new URLSearchParams();
  if (filtro.clienteId) q.set("clienteId", String(filtro.clienteId));
  if (filtro.status) q.set("status", filtro.status);
  if (filtro.de) q.set("de", filtro.de);
  if (filtro.ate) q.set("ate", filtro.ate);
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos?${q}`, { credentials: "include" });
  return (await tratarResposta<{ pedidos: Pedido[] }>(res)).pedidos;
}

export async function criarPedido(entrada: PedidoEntrada): Promise<{ id: number }> {
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  return tratarResposta<{ id: number }>(res);
}

export async function atualizarPedido(id: number, entrada: PedidoEntrada): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  await semConteudo(res);
}

export async function definirStatusPedido(id: number, status: StatusPedido): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/${id}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ status }),
  });
  await semConteudo(res);
}

export async function excluirPedido(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await semConteudo(res);
}

// --- estoque de produto acabado (vive no módulo Produtos) --------------------

export async function fetchEstoqueProdutos(): Promise<EstoqueProduto[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-produtos/estoque`, { credentials: "include" });
  return (await tratarResposta<{ estoque: EstoqueProduto[] }>(res)).estoque;
}

export async function definirEstoqueMinimoProduto(id: number, estoqueMinimo: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-produtos/estoque/${id}/minimo`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ estoqueMinimo }),
  });
  await semConteudo(res);
}

export async function fetchAjustesProduto(): Promise<AjusteProduto[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-produtos/estoque/ajustes`, { credentials: "include" });
  return (await tratarResposta<{ ajustes: AjusteProduto[] }>(res)).ajustes;
}

export async function registrarAjusteProduto(entrada: {
  produtoId: number;
  tipo: "ajuste" | "inventario";
  quantidade?: number;
  contado?: number;
  motivo?: string | null;
}): Promise<{ id: number; diferenca?: number }> {
  const res = await fetch(`${API_BASE}/api/fabrica-produtos/estoque/ajustes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  return tratarResposta<{ id: number; diferenca?: number }>(res);
}

export async function excluirAjusteProduto(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-produtos/estoque/ajustes/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await semConteudo(res);
}

// --- conta corrente e recebimento --------------------------------------------

export async function fetchContaCorrente(): Promise<ContaCorrente[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/conta-corrente`, {
    credentials: "include",
  });
  return (await tratarResposta<{ contas: ContaCorrente[] }>(res)).contas;
}

export async function fetchExtrato(clienteId: number): Promise<LinhaExtrato[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/conta-corrente/${clienteId}`, {
    credentials: "include",
  });
  return (await tratarResposta<{ extrato: LinhaExtrato[] }>(res)).extrato;
}

export async function fetchPagamentos(): Promise<Pagamento[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/pagamentos`, { credentials: "include" });
  return (await tratarResposta<{ pagamentos: Pagamento[] }>(res)).pagamentos;
}

export async function registrarPagamento(entrada: {
  clienteId: number;
  valor: number;
  data?: string | null;
  observacao?: string | null;
}): Promise<{ id: number; saldo: number }> {
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/pagamentos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  return tratarResposta<{ id: number; saldo: number }>(res);
}

export async function excluirPagamento(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/pagamentos/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await semConteudo(res);
}
