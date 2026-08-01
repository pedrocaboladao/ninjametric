import axios from "axios";

// Planilha pública (compartilhada por link) — exportação nativa do Google
// Sheets em CSV, sem precisar de credencial/API key.
const SHEET_ID = "1TlsFJkh_3Aq-1e52sjxok7IJXjvLKzbffXegZw0991U";
const SHEET_GID = "936885221";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

export interface Produto {
  sku: string;
  custo: number;
  precoClassico: number;
  precoPremium: number;
  precoShopee: number;
  ean: string;
}

// Parser CSV simples (RFC4180: aspas, vírgula/quebra de linha dentro de
// campo entre aspas, aspas duplas escapadas com "").
function parseCsv(texto: string): string[][] {
  const linhas: string[][] = [];
  let linhaAtual: string[] = [];
  let campoAtual = "";
  let dentroDeAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentroDeAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campoAtual += '"';
          i++;
        } else {
          dentroDeAspas = false;
        }
      } else {
        campoAtual += c;
      }
      continue;
    }
    if (c === '"') {
      dentroDeAspas = true;
    } else if (c === ",") {
      linhaAtual.push(campoAtual);
      campoAtual = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linhaAtual.push(campoAtual);
      linhas.push(linhaAtual);
      linhaAtual = [];
      campoAtual = "";
    } else {
      campoAtual += c;
    }
  }
  if (campoAtual.length > 0 || linhaAtual.length > 0) {
    linhaAtual.push(campoAtual);
    linhas.push(linhaAtual);
  }
  return linhas;
}

// "R$ 1.234,56" -> 1234.56
function parseMoeda(valor: string): number {
  const numero = valor
    .replace(/^R\$\s*/, "")
    .trim()
    .replace(/\./g, "")
    .replace(",", ".");
  return Number(numero) || 0;
}

// A planilha é organizada em grupos (uma "categoria" por linha de produto
// base), com uma linha separadora repetindo o cabeçalho entre cada grupo —
// ex.: "  706-FITA/FRONTEC,VALOR DE CUSTO,PREÇO CLÁSSICO,...". Linha de
// produto de verdade é a única que tem o valor de custo já formatado como
// "R$ ..." na segunda coluna; título e separadores de grupo não têm.
function parseProdutos(csv: string): Produto[] {
  const linhas = parseCsv(csv);
  const produtos: Produto[] = [];

  for (const linha of linhas) {
    const [sku, custo, classico, premium, shopee, ean] = linha;
    if (!sku || !custo || !/^R\$/.test(custo.trim())) continue;

    produtos.push({
      sku: sku.trim(),
      custo: parseMoeda(custo),
      precoClassico: parseMoeda(classico ?? ""),
      precoPremium: parseMoeda(premium ?? ""),
      precoShopee: parseMoeda(shopee ?? ""),
      ean: (ean ?? "").trim(),
    });
  }

  return produtos;
}

// Cache simples: a planilha não muda a cada minuto, e buscar/reparsear
// ~5 mil linhas a cada carregamento da tela seria desnecessário.
const CACHE_TTL_MS = 60 * 60 * 1000;
let cache: { data: Produto[]; expiraEm: number } | null = null;

export async function listarProdutos(): Promise<Produto[]> {
  if (cache && cache.expiraEm > Date.now()) return cache.data;

  const { data: csv } = await axios.get<string>(CSV_URL);
  const produtos = parseProdutos(csv);

  cache = { data: produtos, expiraEm: Date.now() + CACHE_TTL_MS };
  return produtos;
}
