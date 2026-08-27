import axios from "axios";
import { pool } from "../db/pool";
import { tokenValido } from "./blingAuth";
import { normalizarSku } from "./financeiroService";

// Padroniza o código do produto no Bling pelo código do site.
//
// O site é o padrão porque o SKU dele vem da planilha que alimenta as lojas. O
// ERP escreve o mesmo produto de outro jeito — `RECICLADA-18KG-PRETO` onde o
// site tem `RECICLADA-18L-PRETO` — e a importação de vendas não reconhece: em
// agosto/2026 foram 87 códigos, R$ 419.285,87, 15% da venda do mês parada.
//
// Nenhum deles é produto novo. É sempre a mesma coisa escrita diferente: KG no
// lugar de L, a unidade faltando, a cor abreviada, vírgula onde é ponto.
//
// Duas travas antes de gravar:
//
//   o destino tem que estar livre    renomear pra um código que já existe faz
//                                    o Bling recusar o save inteiro
//   o produto tem que existir        e com o código exato de origem, senão a
//                                    busca pegou outro parecido
//
// Roda em simulação por padrão. Código de produto é o que liga a venda ao
// cadastro; trocar errado quebra o histórico dos dois lados.

const BASE = "https://api.bling.com.br/Api/v3";
const POR_PAGINA = 100;
// mesmo teto de 3 chamadas por segundo do resto da API
const ESPACO_MS = 350;
const TENTATIVAS = 4;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

let proximaLivre = 0;

async function vez(): Promise<void> {
  const agora = Date.now();
  const quando = Math.max(agora, proximaLivre);
  proximaLivre = quando + ESPACO_MS;
  if (quando > agora) await dormir(quando - agora);
}

async function chamar<T>(
  metodo: "get" | "put",
  caminho: string,
  params?: Record<string, unknown>,
  corpo?: unknown
): Promise<T> {
  let espera = 2000;
  for (let tentativa = 1; ; tentativa++) {
    await vez();
    const token = await tokenValido();
    try {
      const { data } = await axios.request<T>({
        method: metodo,
        url: `${BASE}${caminho}`,
        params,
        data: corpo,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(corpo ? { "Content-Type": "application/json" } : {}),
        },
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
      if (axios.isAxiosError(err) && err.response) {
        const d = err.response.data as unknown;
        const t = typeof d === "string" ? d : JSON.stringify(d);
        throw new Error(`Bling ${err.response.status}: ${t.slice(0, 300)}`);
      }
      throw err;
    }
  }
}

interface ProdutoBling {
  id: number;
  nome?: string;
  codigo?: string;
  tipo?: string;
  formato?: string;
  [k: string]: unknown;
}

// Procura pelo código exato. Não varre a base: o Bling da Fábrica guarda também
// o catálogo da Fábrica Loja, que vende no Mercado Livre — são milhares de
// produtos, e a listagem inteira a 3 chamadas por segundo não termina.
//
// O filtro volta o que *parece* com o código, então a conferência é aqui, na
// volta, comparando o código normalizado. Confiar no filtro pegaria o vizinho.
async function acharPorCodigo(codigo: string): Promise<ProdutoBling | null> {
  const alvo = normalizarSku(codigo);
  for (const chave of ["codigo", "pesquisa", "criterio"]) {
    try {
      const r = await chamar<{ data?: ProdutoBling[] }>("get", "/produtos", {
        [chave]: codigo,
        limite: POR_PAGINA,
      });
      const achado = (r.data ?? []).find((p) => normalizarSku(p.codigo ?? "") === alvo);
      if (achado) return achado;
    } catch {
      // filtro que o Bling não conhece vira 400: tenta o próximo jeito
    }
  }
  return null;
}

// Lista o catalogo inteiro do Bling.
//
// Diferente dos contatos, aqui varrer compensa: sao ~6 mil produtos, 100 por
// pagina, e o enfileirador de 350ms fecha em menos de meio minuto. O que nao
// termina e a base de contatos, que carrega tambem o cliente final da Fabrica
// Loja — dezenas de milhares.
export interface ProdutoDoBling {
  id: number;
  codigo: string;
  nome: string;
  preco: number | null;
  situacao: string;
  tipo: string;
  formato: string;
}

export async function listarProdutos(
  aoAndar?: (lidos: number) => void
): Promise<ProdutoDoBling[]> {
  const saida: ProdutoDoBling[] = [];
  for (let pagina = 1; ; pagina++) {
    const r = await chamar<{ data?: ProdutoBling[] }>("get", "/produtos", {
      pagina,
      limite: POR_PAGINA,
      // o catalogo tem produto pai e variacao; os dois interessam, porque o
      // codigo que vai na venda e o da variacao
      criterio: 2,
    });
    const lote = r.data ?? [];
    for (const p of lote) {
      saida.push({
        id: p.id,
        codigo: String(p.codigo ?? "").trim(),
        nome: String(p.nome ?? "").trim(),
        preco: typeof p.preco === "number" ? p.preco : Number(p.preco ?? 0) || null,
        situacao: String(p.situacao ?? ""),
        tipo: String(p.tipo ?? ""),
        formato: String(p.formato ?? ""),
      });
    }
    if (aoAndar) aoAndar(saida.length);
    // pagina incompleta e a ultima: o Bling nao devolve total de registros
    if (lote.length < POR_PAGINA) break;
  }
  return saida;
}

export interface ParPadronizacao {
  de: string;
  para: string;
}

export interface LinhaPadronizacao {
  de: string;
  para: string;
  produtoId: number | null;
  nome: string | null;
  situacao:
    | "renomeado"
    | "já está certo"
    | "não achei no Bling"
    | "destino ocupado"
    | "fora do catálogo do site"
    | "erro";
  detalhe?: string;
}

export interface ResultadoPadronizacao {
  simulacao: boolean;
  pares: number;
  linhas: LinhaPadronizacao[];
}

export async function padronizarCodigos(
  pares: ParPadronizacao[],
  simulacao: boolean
): Promise<ResultadoPadronizacao> {
  // O destino tem que ser um SKU que existe aqui. Renomear pra um código que o
  // site não conhece só mudaria o lugar do problema.
  const { rows } = await pool.query<{ sku: string }>("SELECT sku FROM fabrica_produtos");
  const doSite = new Set(rows.map((r) => normalizarSku(r.sku)));

  const linhas: LinhaPadronizacao[] = [];
  for (const par of pares) {
    const de = String(par.de ?? "").trim();
    const para = String(par.para ?? "").trim();
    if (!de || !para) continue;

    if (!doSite.has(normalizarSku(para))) {
      linhas.push({
        de,
        para,
        produtoId: null,
        nome: null,
        situacao: "fora do catálogo do site",
      });
      continue;
    }

    let origem: ProdutoBling | null;
    try {
      origem = await acharPorCodigo(de);
    } catch (err) {
      linhas.push({
        de,
        para,
        produtoId: null,
        nome: null,
        situacao: "erro",
        detalhe: err instanceof Error ? err.message : "falha ao procurar",
      });
      continue;
    }
    if (!origem) {
      linhas.push({ de, para, produtoId: null, nome: null, situacao: "não achei no Bling" });
      continue;
    }
    if (normalizarSku(origem.codigo ?? "") === normalizarSku(para)) {
      linhas.push({
        de,
        para,
        produtoId: origem.id,
        nome: origem.nome ?? null,
        situacao: "já está certo",
      });
      continue;
    }

    // destino ocupado: o Bling recusaria o save, e sobrescrever calado juntaria
    // dois produtos diferentes no mesmo código
    const ocupado = await acharPorCodigo(para);
    if (ocupado && ocupado.id !== origem.id) {
      linhas.push({
        de,
        para,
        produtoId: origem.id,
        nome: origem.nome ?? null,
        situacao: "destino ocupado",
        detalhe: `o código ${para} já é do produto ${ocupado.id}`,
      });
      continue;
    }

    if (simulacao) {
      linhas.push({
        de,
        para,
        produtoId: origem.id,
        nome: origem.nome ?? null,
        situacao: "renomeado",
      });
      continue;
    }

    try {
      // leitura e devolução: manda o produto inteiro de volta com o código
      // trocado. Montar o corpo do zero apagaria preço, estoque, fornecedor.
      const inteiro = await chamar<{ data: ProdutoBling }>("get", `/produtos/${origem.id}`);
      await chamar("put", `/produtos/${origem.id}`, undefined, {
        ...inteiro.data,
        codigo: para,
      });
      linhas.push({
        de,
        para,
        produtoId: origem.id,
        nome: origem.nome ?? null,
        situacao: "renomeado",
      });
    } catch (err) {
      linhas.push({
        de,
        para,
        produtoId: origem.id,
        nome: origem.nome ?? null,
        situacao: "erro",
        detalhe: err instanceof Error ? err.message : "falha ao gravar",
      });
    }
  }

  return { simulacao, pares: linhas.length, linhas };
}
