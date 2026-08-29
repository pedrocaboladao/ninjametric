import type {
  Pedido,
  PedidoEntrada,
  StatusPedido,
  EstoqueProduto,
  AjusteProduto,
  ContaCorrente,
  IdadeSaldo,
  ConferenciaPlanilha,
  ResultadoImportacao,
  Credito,
  SaldoCredito,
  AlertaProvisorio,
  OrigemCredito,
  Pagamento,
  LinhaExtrato,
  Devolucao,
  CondicaoDevolucao,
  StatusRessarcimento,
  ConsolidadoRessarcimento,
  OrigemPix,
  DestinoPix,
  ConferenciaPix,
  ResultadoPix,
  Entrada,
  ConferenciaNota,
  StatusBling,
  ProgressoBling,
  ClienteApelido,
  ProdutoApelido,
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

// Devolve a pagina e o total do filtro. O total nao e o tamanho da lista: a
// listagem tem teto, e sem esse numero quem conta na tela conta errado — agosto
// de 2026 tem 334 pedidos e a tela mostrava 200, calada.
export async function fetchPedidos(filtro: {
  clienteId?: number;
  status?: StatusPedido;
  de?: string;
  ate?: string;
  limite?: number;
} = {}): Promise<{ pedidos: Pedido[]; total: number }> {
  const q = new URLSearchParams();
  if (filtro.clienteId) q.set("clienteId", String(filtro.clienteId));
  if (filtro.status) q.set("status", filtro.status);
  if (filtro.de) q.set("de", filtro.de);
  if (filtro.ate) q.set("ate", filtro.ate);
  if (filtro.limite) q.set("limite", String(filtro.limite));
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos?${q}`, { credentials: "include" });
  const r = await tratarResposta<{ pedidos: Pedido[]; total?: number }>(res);
  return { pedidos: r.pedidos, total: r.total ?? r.pedidos.length };
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
  // uso próprio da fábrica: grava o custo do momento e vira despesa no DRE
  consumo?: boolean;
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
}): Promise<{
  id: number;
  saldo: number;
  bonificacao: number;
  provisorio: boolean;
  confirmados: number;
}> {
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/pagamentos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  return tratarResposta<{
    id: number;
    saldo: number;
    bonificacao: number;
    provisorio: boolean;
    confirmados: number;
  }>(res);
}

export async function excluirPagamento(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/pagamentos/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await semConteudo(res);
}

// --- devolucoes --------------------------------------------------------------

export async function fetchDevolucoes(filtro: { clienteId?: number } = {}): Promise<{
  devolucoes: Devolucao[];
  notasPendentes: number;
  consolidado: ConsolidadoRessarcimento;
}> {
  const q = new URLSearchParams();
  if (filtro.clienteId) q.set("clienteId", String(filtro.clienteId));
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/devolucoes?${q}`, {
    credentials: "include",
  });
  return tratarResposta<{
    devolucoes: Devolucao[];
    notasPendentes: number;
    consolidado: ConsolidadoRessarcimento;
  }>(res);
}

export async function registrarRessarcimento(
  id: number,
  entrada: {
    status: StatusRessarcimento;
    valor: number;
    data?: string | null;
    protocolo?: string | null;
  }
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/devolucoes/${id}/ressarcimento`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  await semConteudo(res);
}

export async function definirCreditoDevolucao(id: number, credito: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/devolucoes/${id}/credito`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ credito }),
  });
  await semConteudo(res);
}

export async function registrarDevolucao(entrada: {
  clienteId: number;
  produtoId: number;
  quantidade: number;
  condicao: CondicaoDevolucao;
  data?: string | null;
  credito?: number | null;
  notaFiscal?: string | null;
  recebidoPor?: string | null;
  observacao?: string | null;
}): Promise<{ id: number }> {
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/devolucoes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  return tratarResposta<{ id: number }>(res);
}

export async function marcarNotaCancelada(id: number, notaCancelada: boolean): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/devolucoes/${id}/nota`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ notaCancelada }),
  });
  await semConteudo(res);
}

export async function excluirDevolucao(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/devolucoes/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await semConteudo(res);
}

// ---------------------------------------------------------------- créditos

export async function fetchCreditos(): Promise<{
  creditos: Credito[];
  saldos: SaldoCredito[];
  percentual: number;
  alertas: AlertaProvisorio[];
}> {
  const res = await fetch(`${API_BASE}/api/fabrica-creditos`, { credentials: "include" });
  return tratarResposta<{
    creditos: Credito[];
    saldos: SaldoCredito[];
    percentual: number;
    alertas: AlertaProvisorio[];
  }>(res);
}

// Tira os provisórios de uma loja: ela virou o mês sem quitar, perdeu o prêmio.
export async function excluirProvisorios(clienteId: number): Promise<{ excluidos: number }> {
  const res = await fetch(`${API_BASE}/api/fabrica-creditos/provisorios/${clienteId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return tratarResposta<{ excluidos: number }>(res);
}

// A antecipação e a bonificação dela saem de uma chamada só: separar deixaria
// alguém lançar o dinheiro e esquecer os 3,5%.
export async function lancarAntecipacao(entrada: {
  clienteId: number;
  valor: number;
  data?: string;
  observacao?: string | null;
}): Promise<{ antecipacao: number; bonificacao: number; percentual: number }> {
  const res = await fetch(`${API_BASE}/api/fabrica-creditos/antecipacao`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  return tratarResposta<{ antecipacao: number; bonificacao: number; percentual: number }>(res);
}

export async function lancarCredito(entrada: {
  clienteId: number;
  valor: number;
  origem: OrigemCredito;
  data?: string;
  observacao?: string | null;
}): Promise<{ id: number }> {
  const res = await fetch(`${API_BASE}/api/fabrica-creditos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  return tratarResposta<{ id: number }>(res);
}

export async function definirPercentualBonificacao(percentual: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-creditos/percentual`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ percentual }),
  });
  if (!res.ok) await tratarResposta(res);
}

export async function excluirCredito(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-creditos/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) await tratarResposta(res);
}

export async function conferirPlanilha(
  texto: string,
  origem: string
): Promise<ConferenciaPlanilha> {
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/vendas-planilha`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ texto, origem }),
  });
  return tratarResposta<ConferenciaPlanilha>(res);
}

export async function importarPlanilha(
  texto: string,
  origem: string
): Promise<ResultadoImportacao> {
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/vendas-planilha/importar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ texto, origem }),
  });
  return tratarResposta<ResultadoImportacao>(res);
}

export async function fetchIdadeDoSaldo(): Promise<IdadeSaldo> {
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/idade-do-saldo`, {
    credentials: "include",
  });
  return tratarResposta<IdadeSaldo>(res);
}

export async function fetchOrigensPix(): Promise<OrigemPix[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-pix/origens`, { credentials: "include" });
  const { origens } = await tratarResposta<{ origens: OrigemPix[] }>(res);
  return origens;
}

export async function salvarOrigemPix(
  nome: string,
  clienteId: number | null,
  destino: DestinoPix
): Promise<OrigemPix[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-pix/origens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ nome, clienteId, destino }),
  });
  const { origens } = await tratarResposta<{ origens: OrigemPix[] }>(res);
  return origens;
}

export async function excluirOrigemPix(id: number): Promise<OrigemPix[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-pix/origens/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  const { origens } = await tratarResposta<{ origens: OrigemPix[] }>(res);
  return origens;
}

// confere e importa mandam o mesmo arquivo: o conferir não grava nada, e é
// sempre ele primeiro — o importar mexe no saldo de todas as lojas de uma vez
async function enviarPix<T>(caminho: string, arquivo: File): Promise<T> {
  const form = new FormData();
  form.append("arquivo", arquivo);
  const res = await fetch(`${API_BASE}/api/fabrica-pix/${caminho}`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  return tratarResposta<T>(res);
}

export function conferirPix(arquivo: File): Promise<ConferenciaPix> {
  return enviarPix<ConferenciaPix>("conferir", arquivo);
}

export function importarPix(arquivo: File): Promise<ResultadoPix> {
  return enviarPix<ResultadoPix>("importar", arquivo);
}

// Sobe a planilha de vendas como arquivo. Devolve a mesma conferência de
// sempre, mais o texto convertido — o lançamento continua indo pela rota de
// texto, então arquivo e cola nunca divergem.
export async function conferirPlanilhaArquivo(
  arquivo: File,
  origem: string
): Promise<ConferenciaPlanilha & { texto: string }> {
  const form = new FormData();
  form.append("arquivo", arquivo);
  form.append("origem", origem);
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/vendas-planilha/arquivo`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  return tratarResposta<ConferenciaPlanilha & { texto: string }>(res);
}

export async function fetchEntradas(): Promise<Entrada[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-entradas`, { credentials: "include" });
  const { entradas } = await tratarResposta<{ entradas: Entrada[] }>(res);
  return entradas;
}

// Confere a nota do fornecedor sem gravar: mostra o que entra e o que ficou
// sem SKU. Nota de compra tem dezenas de linhas, e digitar uma a uma é onde o
// estoque começa a errar.
export async function conferirNota(arquivo: File): Promise<ConferenciaNota> {
  const form = new FormData();
  form.append("arquivo", arquivo);
  const res = await fetch(`${API_BASE}/api/fabrica-entradas/conferir`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  return tratarResposta<ConferenciaNota>(res);
}

export async function lancarEntrada(entrada: {
  fornecedorNome: string | null;
  documento: string | null;
  data: string | null;
  observacao: string | null;
  itens: Array<{ produtoId: number; quantidade: number; custoUnitario: number }>;
}): Promise<{ id: number; itens: number; total: number }> {
  const res = await fetch(`${API_BASE}/api/fabrica-entradas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entrada),
  });
  return tratarResposta<{ id: number; itens: number; total: number }>(res);
}

export async function excluirEntrada(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-entradas/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await tratarResposta<{ ok: boolean }>(res);
}

export async function statusBling(): Promise<StatusBling> {
  const res = await fetch(`${API_BASE}/api/fabrica-bling/status`, { credentials: "include" });
  return tratarResposta<StatusBling>(res);
}

export async function autorizarBling(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/fabrica-bling/autorizar`, { credentials: "include" });
  const { url } = await tratarResposta<{ url: string }>(res);
  return url;
}

export async function desconectarBling(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-bling/conexao`, {
    method: "DELETE",
    credentials: "include",
  });
  await tratarResposta<{ ok: boolean }>(res);
}

// Começa a puxada das vendas do período. Não espera terminar: um mês passa de
// dez minutos e o proxy corta muito antes. Quem acompanha é progressoBling, e
// quem lança continua sendo a rota de importar planilha — o caminho do ERP e o
// do arquivo terminam iguais.
export async function sincronizarBling(
  dataInicial: string,
  dataFinal: string
): Promise<ProgressoBling> {
  const res = await fetch(`${API_BASE}/api/fabrica-bling/sincronizar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ dataInicial, dataFinal }),
  });
  return tratarResposta<ProgressoBling>(res);
}

// O que a rodada automatica faz, na hora que o operador pedir.
//
// Le os ultimos 7 dias do Bling e lanca o que ainda nao entrou. Pode clicar
// quantas vezes quiser: a mesma venda volta e e reconhecida por origem +
// documento + SKU, entao o segundo clique so acrescenta o que apareceu depois
// do primeiro.
export interface RodadaSincronia {
  de: string;
  ate: string;
  pedidosLidos: number;
  itensLidos: number;
  falhas: Array<{ id: number; motivo: string }>;
  pedidosCriados: number;
  itensLancados: number;
  valorLancado: number;
  puladas: number;
  motivos: Record<string, number>;
  skusFaltando: Array<{ sku: string; linhas: number; quantidade: number; valor: number }>;
  clientesFaltando: Array<{ nome: string; linhas: number; valor: number }>;
  erro: string | null;
}

export async function sincronizarAgora(): Promise<RodadaSincronia> {
  const res = await fetch(`${API_BASE}/api/fabrica-bling/automatica`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: "{}",
  });
  return tratarResposta<RodadaSincronia>(res);
}

export async function ultimaRodada(): Promise<{
  rodando: boolean;
  ultima: RodadaSincronia | null;
}> {
  const res = await fetch(`${API_BASE}/api/fabrica-bling/automatica`, {
    credentials: "include",
  });
  return tratarResposta<{ rodando: boolean; ultima: RodadaSincronia | null }>(res);
}

export async function progressoBling(): Promise<ProgressoBling> {
  const res = await fetch(`${API_BASE}/api/fabrica-bling/sincronizacao`, {
    credentials: "include",
  });
  return tratarResposta<ProgressoBling>(res);
}

// Ensina ao sistema como o ERP escreve o nome de um cliente. Vale pra sempre:
// da próxima importação em diante o nome casa sozinho.
export async function criarApelidoCliente(
  clienteId: number,
  apelido: string
): Promise<ClienteApelido> {
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/apelidos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ clienteId, apelido }),
  });
  return tratarResposta<ClienteApelido>(res);
}

// Ensina ao sistema como o ERP escreve o código de um produto. O ERP grava o
// código dentro do pedido, congelado na venda — renomear lá não conserta o que
// já foi vendido, e é isto que conserta.
export async function criarApelidoSku(
  produtoId: number,
  apelido: string
): Promise<ProdutoApelido> {
  const res = await fetch(`${API_BASE}/api/fabrica-pedidos/apelidos-sku`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ produtoId, apelido }),
  });
  return tratarResposta<ProdutoApelido>(res);
}
