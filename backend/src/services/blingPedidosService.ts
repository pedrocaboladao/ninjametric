import axios from "axios";
import { pool } from "../db/pool";
import { tokenValido } from "./blingAuth";

// Puxa os pedidos de venda do Bling e devolve no formato que a conferência de
// planilha já entende — cliente, data, número, SKU, quantidade e valor.
//
// A listagem não traz os itens: vem só o cabeçalho do pedido. Os itens saem no
// detalhe, um GET por pedido. Um mês da fábrica dá quase mil pedidos, então a
// busca é em lotes pequenos com pausa entre eles: a API do Bling limita a 3
// chamadas por segundo, e estourar isso devolve 429 no meio da sincronização.

const BASE = "https://api.bling.com.br/Api/v3";
const POR_PAGINA = 100;

// O Bling deixa passar 3 chamadas por segundo. Disparar 4 juntas e esperar
// 1,5s dá 2,7/s na média e mesmo assim estoura: o teto é instantâneo, não
// médio. E o pedido que toma 429 volta sem itens, calado — numa janela de três
// dias de agosto de 2026 isso comeu 85 dos 207 pedidos, 41% da venda, sem erro
// nenhum aparecer na tela.
//
// Então as chamadas saem enfileiradas, uma a cada 350ms, e quem toma 429 tenta
// de novo com espera crescente em vez de virar buraco no resultado.
const ESPACO_MS = 350;
const TENTATIVAS = 4;

export interface PedidoBling {
  id: number;
  numero: string;
  data: string;
  cliente: string;
  total: number;
  situacao: number | null;
}

export interface ItemBling {
  numero: string;
  data: string;
  cliente: string;
  sku: string;
  descricao: string;
  quantidade: number;
  valor: number;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Marca quando a próxima chamada pode sair. Cada uma reserva seu lugar antes de
// esperar, então duas chamadas concorrentes pegam horários diferentes em vez de
// acordarem juntas.
let proximaLivre = 0;

async function vez(): Promise<void> {
  const agora = Date.now();
  const quando = Math.max(agora, proximaLivre);
  proximaLivre = quando + ESPACO_MS;
  if (quando > agora) await dormir(quando - agora);
}

async function get<T>(caminho: string, params?: Record<string, unknown>): Promise<T> {
  let espera = 2000;
  for (let tentativa = 1; ; tentativa++) {
    await vez();
    const token = await tokenValido();
    try {
      const { data } = await axios.get<T>(`${BASE}${caminho}`, {
        params,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        timeout: 30000,
      });
      return data;
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status === 429 && tentativa < TENTATIVAS) {
        await dormir(espera);
        espera *= 2;
        continue;
      }
      throw err;
    }
  }
}

interface RespostaLista {
  data: Array<{
    id: number;
    numero?: number | string;
    data?: string;
    total?: number;
    contato?: { id?: number; nome?: string };
    situacao?: { id?: number };
  }>;
}

export async function listarPedidos(
  dataInicial: string,
  dataFinal: string
): Promise<PedidoBling[]> {
  const saida: PedidoBling[] = [];
  for (let pagina = 1; ; pagina++) {
    const r = await get<RespostaLista>("/pedidos/vendas", {
      pagina,
      limite: POR_PAGINA,
      dataInicial,
      dataFinal,
    });
    const lote = r.data ?? [];
    for (const p of lote) {
      saida.push({
        id: p.id,
        numero: String(p.numero ?? p.id),
        data: String(p.data ?? "").slice(0, 10),
        cliente: p.contato?.nome ?? "",
        total: Number(p.total ?? 0),
        situacao: p.situacao?.id ?? null,
      });
    }
    // página incompleta é a última: o Bling não devolve total de registros
    if (lote.length < POR_PAGINA) break;
  }
  return saida;
}

interface RespostaDetalhe {
  data: {
    id: number;
    numero?: number | string;
    data?: string;
    contato?: { nome?: string };
    itens?: Array<{
      codigo?: string;
      descricao?: string;
      quantidade?: number;
      valor?: number;
      produto?: { codigo?: string; nome?: string };
    }>;
  };
}

// O pedido como o Bling manda, sem filtro.
//
// A gente le so cliente, data, SKU, quantidade e valor — e o resto e descartado
// sem ninguem nunca ter olhado. Quando a pergunta e "a API traz a hora de quem
// digitou?", so tem um jeito honesto de responder: pedir um pedido e ler o que
// veio. A documentacao e uma pagina que carrega por javascript e nao da pra ler
// de fora.
//
// Leitura pura, um pedido por vez.
export async function pedidoCru(id: number): Promise<unknown> {
  const r = await get<unknown>(`/pedidos/vendas/${id}`);
  return r;
}

export async function itensDoPedido(id: number): Promise<ItemBling[]> {
  const r = await get<RespostaDetalhe>(`/pedidos/vendas/${id}`);
  const p = r.data;
  const numero = String(p.numero ?? p.id);
  const data = String(p.data ?? "").slice(0, 10);
  const cliente = p.contato?.nome ?? "";
  return (p.itens ?? []).map((i) => {
    const qt = Number(i.quantidade ?? 0);
    const vl = Number(i.valor ?? 0);
    return {
      numero,
      data,
      cliente,
      // o código pode vir na linha ou dentro do produto, conforme o pedido
      sku: (i.codigo ?? i.produto?.codigo ?? "").trim(),
      descricao: (i.descricao ?? i.produto?.nome ?? "").trim(),
      quantidade: qt,
      // valor é unitário: o que a conferência espera é o total da linha
      valor: qt * vl,
    };
  });
}

export interface ResultadoBusca {
  pedidos: number;
  itens: ItemBling[];
  falhas: Array<{ id: number; motivo: string }>;
}

export async function buscarVendas(
  dataInicial: string,
  dataFinal: string,
  aoAndar?: (feitos: number, total: number) => void
): Promise<ResultadoBusca> {
  const pedidos = await listarPedidos(dataInicial, dataFinal);
  const itens: ItemBling[] = [];
  const falhas: Array<{ id: number; motivo: string }> = [];

  // Um pedido por vez: quem espaça as chamadas é o enfileirador do get, e
  // paralelizar aqui só criaria a rajada que o Bling recusa.
  for (let i = 0; i < pedidos.length; i++) {
    const p = pedidos[i];
    try {
      itens.push(...(await itensDoPedido(p.id)));
    } catch (err) {
      falhas.push({ id: p.id, motivo: err instanceof Error ? err.message : "erro" });
    }
    if (aoAndar) aoAndar(i + 1, pedidos.length);
  }

  return { pedidos: pedidos.length, itens, falhas };
}

// Vira o texto separado por tab que conferirPlanilhaVendas já lê. Passar pelo
// mesmo caminho da planilha é de propósito: o casamento de SKU, a trava de
// duplicidade pelo número do pedido e a conferência continuam sendo os mesmos
// de quando o arquivo vem à mão.
export function paraTexto(itens: ItemBling[]): string {
  const linhas = ["Cliente\tData\tNum. Pedido\tSKU\tQuantidade\tValor"];
  for (const i of itens) {
    if (!i.sku || i.quantidade <= 0) continue;
    const dt = /^\d{4}-\d{2}-\d{2}$/.test(i.data)
      ? `${i.data.slice(8, 10)}/${i.data.slice(5, 7)}/${i.data.slice(0, 4)}`
      : i.data;
    linhas.push(
      [
        i.cliente.replace(/\t/g, " "),
        dt,
        i.numero,
        i.sku,
        String(i.quantidade),
        i.valor.toFixed(2),
      ].join("\t")
    );
  }
  return linhas.join("\n");
}

// Quais pedidos já entraram, pra sincronizar só o que falta.
export async function jaImportados(numeros: string[]): Promise<Set<string>> {
  if (!numeros.length) return new Set();
  const { rows } = await pool.query<{ documento: string }>(
    "SELECT documento FROM fabrica_venda_importada WHERE documento = ANY($1::text[])",
    [numeros]
  );
  return new Set(rows.map((r) => r.documento));
}

// ---------------------------------------------------------------------------
// Criar pedido de venda no Bling
//
// O caminho de entrada da venda: a loja manda a lista de separacao, e o pedido
// nasce aqui em vez de ser digitado na tela. Dai o site puxa no sync das 6h e o
// custo entra sozinho — nenhuma etapa nova no meio.
//
// Escopo exigido: **Pedidos de Venda: incluir/alterar**. Mexer no app do Bling
// invalida o token na hora, entao reautorizar em seguida em
// `/api/fabrica-bling/autorizar` — senao o sync da manha seguinte cai.

async function escreverPedido<T>(caminho: string, corpo: unknown): Promise<T> {
  let espera = 2000;
  for (let tentativa = 1; ; tentativa++) {
    await vez();
    const token = await tokenValido();
    try {
      const resp = await axios.post<T>(`${BASE}${caminho}`, corpo, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        timeout: 30000,
      });
      return resp.data;
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status === 429 && tentativa < TENTATIVAS) {
        await dormir(espera);
        espera *= 2;
        continue;
      }
      // erro do Bling vem no corpo e e o que diz qual campo ele recusou; sem
      // isso sobra "Request failed with status code 400" e nada mais
      if (axios.isAxiosError(err) && err.response) {
        const d = err.response.data as unknown;
        const t = typeof d === "string" ? d : JSON.stringify(d);
        throw new Error(`Bling ${err.response.status}: ${t.slice(0, 400)}`);
      }
      throw err;
    }
  }
}

export interface ItemNovoPedido {
  /** Codigo do produto no Bling. Tem que ser o SKU padronizado — o Bling casa
   *  por codigo, e codigo que ele nao conhece ele **aceita e cria item solto**,
   *  sem ligar no produto. Ai a saida de estoque nao acontece e o CMV fica zero. */
  codigo: string;
  quantidade: number;
  valor: number;
  descricao?: string;
}

export interface NovoPedidoVenda {
  contatoId: number;
  /** AAAA-MM-DD. Sem isso o Bling carimba a data de hoje. */
  data: string;
  itens: ItemNovoPedido[];
  numeroLoja?: string;
  observacoes?: string;
}

export interface PedidoCriado {
  id: number;
  numero: string;
  total: number;
  itens: number;
  /** o que o Bling devolveu na releitura, pra conferir antes de confiar */
  conferido: boolean;
}

/**
 * Cria um pedido de venda e **le de volta** antes de dizer que deu certo.
 *
 * A releitura nao e zelo: o Bling aceita campo que nao conhece e responde 200
 * calado. Sem conferir item e total, um pedido pela metade passaria por criado.
 */
export async function criarPedidoVenda(p: NovoPedidoVenda): Promise<PedidoCriado> {
  if (!Number.isInteger(p.contatoId) || p.contatoId <= 0) {
    throw new Error("Informe o contato do Bling.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.data)) throw new Error("Data invalida.");
  if (!p.itens.length) throw new Error("Pedido sem itens.");
  for (const i of p.itens) {
    if (!i.codigo.trim()) throw new Error("Item sem codigo.");
    if (!(i.quantidade > 0)) throw new Error(`Quantidade invalida em ${i.codigo}.`);
    if (!(i.valor > 0)) throw new Error(`Valor invalido em ${i.codigo}.`);
  }

  const corpo = {
    data: p.data,
    contato: { id: p.contatoId },
    numeroLoja: p.numeroLoja,
    observacoes: p.observacoes,
    itens: p.itens.map((i) => ({
      codigo: i.codigo,
      descricao: i.descricao ?? i.codigo,
      quantidade: i.quantidade,
      valor: i.valor,
    })),
  };

  const r = await escreverPedido<{ data?: { id?: number } }>("/pedidos/vendas", corpo);
  const id = Number(r?.data?.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("O Bling respondeu sem o id do pedido.");
  }

  const esperado = Number(
    p.itens.reduce((s, i) => s + i.quantidade * i.valor, 0).toFixed(2)
  );
  // releitura pelo mesmo caminho de `itensDoPedido`: o detalhe nao traz total,
  // entao ele sai da soma dos itens — que e justamente o que precisa bater
  const { data: d } = await get<RespostaDetalhe>(`/pedidos/vendas/${id}`);
  const linhas = d.itens ?? [];
  const total = Number(
    linhas
      .reduce((s, i) => s + Number(i.quantidade ?? 0) * Number(i.valor ?? 0), 0)
      .toFixed(2)
  );
  return {
    id,
    numero: String(d.numero ?? ""),
    total,
    itens: linhas.length,
    conferido: linhas.length === p.itens.length && Math.abs(total - esperado) <= 0.02,
  };
}
