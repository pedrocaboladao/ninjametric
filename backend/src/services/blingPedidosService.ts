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
// 3 req/s é o teto do Bling; 4 em paralelo com pausa fica abaixo com folga
const LOTE = 4;
const PAUSA_MS = 1500;

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

async function get<T>(caminho: string, params?: Record<string, unknown>): Promise<T> {
  const token = await tokenValido();
  const { data } = await axios.get<T>(`${BASE}${caminho}`, {
    params,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    timeout: 30000,
  });
  return data;
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
    await dormir(PAUSA_MS);
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

  for (let i = 0; i < pedidos.length; i += LOTE) {
    const fatia = pedidos.slice(i, i + LOTE);
    const r = await Promise.all(
      fatia.map(async (p) => {
        try {
          return { ok: true as const, itens: await itensDoPedido(p.id) };
        } catch (err) {
          return {
            ok: false as const,
            id: p.id,
            motivo: err instanceof Error ? err.message : "erro",
          };
        }
      })
    );
    for (const x of r) {
      if (x.ok) itens.push(...x.itens);
      else falhas.push({ id: x.id, motivo: x.motivo });
    }
    if (aoAndar) aoAndar(Math.min(i + LOTE, pedidos.length), pedidos.length);
    if (i + LOTE < pedidos.length) await dormir(PAUSA_MS);
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
