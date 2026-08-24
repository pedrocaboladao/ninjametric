import { pool } from "../db/pool";
import { normalizarSku } from "./financeiroService";

// Vendas que a API do Mercado Livre não vê: Shopee e venda direta.
//
// Medido num período de 7 dias, a API enxerga 65% do que a fábrica vendeu —
// R$ 570 mil de R$ 884 mil. O resto sai de outros canais, e hoje o funcionário
// digita tudo à mão. Isto lê o relatório colado direto da planilha.
//
// Aceita o que o Excel põe na área de transferência (TSV) e também CSV com
// ponto e vírgula, que é como o relatório da Shopee costuma sair. Descobre a
// coluna pelo cabeçalho em vez de exigir ordem fixa: cada canal exporta numa
// ordem diferente, e obrigar o operador a reorganizar colunas é onde ele
// desiste e volta a digitar.

export interface LinhaPlanilha {
  linha: number;
  cliente: string;
  clienteId: number | null;
  data: string | null;
  documento: string | null;
  sku: string;
  produtoId: number | null;
  produtoNome: string | null;
  quantidade: number;
  precoUnitario: number;
  total: number;
  // o que impede esta linha de virar pedido
  problema: string | null;
  jaImportada: boolean;
}

export interface ConferenciaPlanilha {
  origem: string;
  linhas: LinhaPlanilha[];
  prontas: number;
  comProblema: number;
  jaImportadas: number;
  totalValor: number;
  // cabeçalhos que reconheci, pro operador ver se leu o arquivo certo
  colunas: Record<string, string>;
}

// nome que pode aparecer no cabeçalho -> campo interno
const COLUNAS: Record<string, string[]> = {
  cliente: ["cliente", "empresa", "loja", "comprador", "razaosocial", "destinatario"],
  data: ["data", "datavenda", "datadopedido", "datacriacao", "dia", "datadeaprovacao"],
  documento: ["numpedido", "numerodopedido", "pedido", "numero", "orderid", "codigodopedido", "nf"],
  sku: ["sku", "codigo", "referencia", "skureferencia", "numerodereferenciasku", "produto"],
  quantidade: ["quantidade", "qtd", "qtde", "quant"],
  valor: ["valor", "valortotal", "total", "precototal", "subtotal"],
  precoUnitario: ["precounitario", "valorunitario", "preco", "unitario"],
};

function chave(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// "1.234,56" e "1234.56" — o Excel brasileiro e o relatório em inglês
function numero(v: string): number {
  const t = String(v ?? "").replace(/[R$\s]/g, "").trim();
  if (!t) return 0;
  // com vírgula decimal: tira o ponto de milhar
  if (/,\d{1,2}$/.test(t)) return Number(t.replace(/\./g, "").replace(",", ".")) || 0;
  return Number(t.replace(/,/g, "")) || 0;
}

function data(v: string): string | null {
  const t = String(v ?? "").trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function separar(linha: string): string[] {
  // tab primeiro: é o que o Excel põe na área de transferência. Só cai pro
  // ponto e vírgula se não houver tab nenhum, senão um campo com ";" dentro
  // partiria a linha errada.
  return (linha.includes("\t") ? linha.split("\t") : linha.split(";")).map((c) => c.trim());
}

export async function conferirPlanilhaVendas(
  texto: string,
  origem: string
): Promise<ConferenciaPlanilha> {
  const brutas = texto.split(/\r?\n/).filter((l) => l.trim());
  if (!brutas.length) throw new Error("Cole as linhas da planilha.");

  // acha o cabeçalho: a primeira linha que reconhece pelo menos duas colunas
  let iCabecalho = -1;
  const mapa: Record<string, number> = {};
  for (let i = 0; i < Math.min(brutas.length, 10); i++) {
    const cols = separar(brutas[i]);
    const achou: Record<string, number> = {};
    cols.forEach((c, idx) => {
      const k = chave(c);
      for (const [campo, nomes] of Object.entries(COLUNAS)) {
        if (achou[campo] === undefined && nomes.includes(k)) achou[campo] = idx;
      }
    });
    if (Object.keys(achou).length >= 2) {
      iCabecalho = i;
      Object.assign(mapa, achou);
      break;
    }
  }
  if (iCabecalho < 0) {
    throw new Error(
      "Não achei o cabeçalho. A primeira linha precisa ter os nomes das colunas — SKU, Quantidade, Valor, Data, Cliente."
    );
  }
  if (mapa.sku === undefined) throw new Error("Não achei a coluna do SKU.");

  const cabecalho = separar(brutas[iCabecalho]);
  const colunas: Record<string, string> = {};
  for (const [campo, idx] of Object.entries(mapa)) colunas[campo] = cabecalho[idx] ?? "";

  const [produtos, clientes, importadas] = await Promise.all([
    pool.query<{ id: number; sku: string; nome: string; preco_venda: string }>(
      "SELECT id, sku, nome, preco_venda FROM fabrica_produtos WHERE ativo = TRUE"
    ),
    pool.query<{ id: number; nome: string }>("SELECT id, nome FROM fabrica_clientes"),
    pool.query<{ documento: string | null; sku: string | null }>(
      "SELECT documento, sku FROM fabrica_venda_importada WHERE origem = $1",
      [origem]
    ),
  ]);

  const porSku = new Map(produtos.rows.map((p) => [normalizarSku(p.sku), p]));
  const porCliente = new Map(clientes.rows.map((c) => [normalizarSku(c.nome), c]));
  const jaEntrou = new Set(
    importadas.rows.map((i) => `${i.documento ?? ""}|${normalizarSku(i.sku ?? "")}`)
  );

  const linhas: LinhaPlanilha[] = [];
  for (let i = iCabecalho + 1; i < brutas.length; i++) {
    const cols = separar(brutas[i]);
    const pega = (campo: string) =>
      mapa[campo] !== undefined ? (cols[mapa[campo]] ?? "").trim() : "";

    const sku = pega("sku");
    if (!sku) continue;

    const nomeCliente = pega("cliente");
    const cliente = porCliente.get(normalizarSku(nomeCliente)) ?? null;
    const produto = porSku.get(normalizarSku(sku)) ?? null;
    const qtd = mapa.quantidade !== undefined ? numero(pega("quantidade")) : 1;
    const d = data(pega("data"));
    const doc = pega("documento") || null;

    // o valor da planilha manda: é o que a loja foi cobrada de verdade. O preço
    // do cadastro só entra quando a planilha não trouxe valor nenhum.
    const valorPlanilha = mapa.valor !== undefined ? numero(pega("valor")) : 0;
    const unitPlanilha = mapa.precoUnitario !== undefined ? numero(pega("precoUnitario")) : 0;
    const unit =
      unitPlanilha ||
      (valorPlanilha && qtd ? valorPlanilha / qtd : 0) ||
      (produto ? Number(produto.preco_venda) : 0);
    const total = valorPlanilha || unit * qtd;

    const problemas: string[] = [];
    if (!produto) problemas.push("SKU não cadastrado");
    if (!cliente) problemas.push(nomeCliente ? "cliente não cadastrado" : "sem cliente");
    if (!d) problemas.push("data inválida");
    if (qtd <= 0) problemas.push("quantidade zerada");

    linhas.push({
      linha: i + 1,
      cliente: nomeCliente,
      clienteId: cliente?.id ?? null,
      data: d,
      documento: doc,
      sku,
      produtoId: produto?.id ?? null,
      produtoNome: produto?.nome ?? null,
      quantidade: qtd,
      precoUnitario: unit,
      total,
      problema: problemas.length ? problemas.join(" · ") : null,
      jaImportada: doc ? jaEntrou.has(`${doc}|${normalizarSku(sku)}`) : false,
    });
  }

  return {
    origem,
    linhas,
    prontas: linhas.filter((l) => !l.problema && !l.jaImportada).length,
    comProblema: linhas.filter((l) => l.problema).length,
    jaImportadas: linhas.filter((l) => l.jaImportada).length,
    totalValor: linhas.filter((l) => !l.jaImportada).reduce((s, l) => s + l.total, 0),
    colunas,
  };
}
