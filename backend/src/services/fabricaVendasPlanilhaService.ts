import { pool } from "../db/pool";
import { casarCliente } from "./fabricaClienteApelidosService";
import {
  casarProduto,
  indiceFrouxo,
} from "./fabricaProdutoApelidosService";
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
  // Quantas linhas o arquivo tinha depois do cabeçalho e quantas eram vazias.
  // Sem isso não dá pra conferir o total contra o Excel: some uma linha e
  // ninguém descobre onde.
  linhasNoArquivo: number;
  linhasVazias: number;
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
  // Percorre o texto ORIGINAL, sem filtrar branco antes. O filtro que existia
  // aqui tirava a linha vazia da frente de qualquer contagem, entao nao havia
  // como dizer quantas linhas o arquivo tinha de verdade — e conferir o total
  // contra o Excel virava adivinhacao.
  const todas = texto.split(/\r?\n/);
  // "a\nb\n" termina em string vazia; ela nao e linha de planilha
  while (todas.length && !todas[todas.length - 1].trim()) todas.pop();
  if (!todas.length) throw new Error("Cole as linhas da planilha.");

  // acha o cabeçalho: a primeira linha que reconhece pelo menos duas colunas.
  // Conta so as linhas com conteudo, senao planilha que comeca com espaco em
  // branco gasta as dez tentativas antes de chegar no cabeçalho.
  let iCabecalho = -1;
  const mapa: Record<string, number> = {};
  let examinadas = 0;
  for (let i = 0; i < todas.length && examinadas < 10; i++) {
    if (!todas[i].trim()) continue;
    examinadas++;
    const cols = separar(todas[i]);
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
  if (mapa.sku === undefined) {
    // dizer o que ACHOU é o que permite a pessoa perceber que subiu o
    // relatório por pedido em vez do relatório por item
    const achadas = Object.keys(mapa)
      .map((k) => separar(todas[iCabecalho])[mapa[k]])
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `Não achei a coluna do SKU. Reconheci: ${achadas || "nenhuma"}. ` +
        "Esta tela lê venda por item — precisa de uma coluna de SKU pra saber " +
        "qual produto saiu. Relatório só com número do pedido, cliente e total " +
        "não serve aqui."
    );
  }

  const cabecalho = separar(todas[iCabecalho]);
  const colunas: Record<string, string> = {};
  for (const [campo, idx] of Object.entries(mapa)) colunas[campo] = cabecalho[idx] ?? "";

  const [produtos, clientes, apelidos, apelidosSku, importadas] = await Promise.all([
    pool.query<{ id: number; sku: string; nome: string; preco_venda: string }>(
      "SELECT id, sku, nome, preco_venda FROM fabrica_produtos WHERE ativo = TRUE"
    ),
    pool.query<{ id: number; nome: string }>("SELECT id, nome FROM fabrica_clientes"),
    pool.query<{ chave: string; cliente_id: number; nome: string }>(
      `SELECT a.chave, a.cliente_id, c.nome
         FROM fabrica_cliente_apelidos a
         JOIN fabrica_clientes c ON c.id = a.cliente_id`
    ),
    pool.query<{ chave: string; produto_id: number }>(
      "SELECT chave, produto_id FROM fabrica_produto_apelidos"
    ),
    pool.query<{ documento: string | null; sku: string | null }>(
      "SELECT documento, sku FROM fabrica_venda_importada WHERE origem = $1",
      [origem]
    ),
  ]);

  const porSku = new Map(produtos.rows.map((p) => [normalizarSku(p.sku), p]));
  const porId = new Map(produtos.rows.map((p) => [p.id, p]));
  const porApelidoSku = new Map(
    apelidosSku.rows
      .map((a) => [a.chave, porId.get(a.produto_id)] as const)
      .filter((x): x is [string, (typeof produtos.rows)[number]] => Boolean(x[1]))
  );
  const porFrouxa = indiceFrouxo(produtos.rows);
  const porCliente = new Map(clientes.rows.map((c) => [normalizarSku(c.nome), c]));
  const porApelido = new Map(
    apelidos.rows.map((a) => [a.chave, { id: a.cliente_id, nome: a.nome }])
  );
  const jaEntrou = new Set(
    importadas.rows.map((i) => `${i.documento ?? ""}|${normalizarSku(i.sku ?? "")}`)
  );

  const linhas: LinhaPlanilha[] = [];
  let vazias = 0;
  for (let i = iCabecalho + 1; i < todas.length; i++) {
    if (!todas[i].trim()) {
      vazias++;
      continue;
    }
    const cols = separar(todas[i]);
    const pega = (campo: string) =>
      mapa[campo] !== undefined ? (cols[mapa[campo]] ?? "").trim() : "";

    // linha totalmente em branco: fim de planilha, separador entre blocos.
    // Essa some mesmo, mas fica contada pra soma bater com o Excel.
    if (cols.every((c) => c === "")) {
      vazias++;
      continue;
    }

    const sku = pega("sku");
    const nomeCliente = pega("cliente");
    // nome igual, depois apelido, depois prefixo — ver fabricaClienteApelidosService
    const achado = casarCliente(nomeCliente, porCliente, porApelido, clientes.rows);
    const cliente = achado.cliente;
    // SKU igual, depois apelido, depois frouxo — ver fabricaProdutoApelidosService
    const achadoSku = sku
      ? casarProduto(sku, porSku, porApelidoSku, porFrouxa)
      : { produto: null, ambiguo: false };
    const produto = achadoSku.produto;
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
    // sem SKU a linha nao vira pedido, mas aparece: sumir com ela deixava o
    // operador somando um total que nao fecha com o arquivo dele
    if (!sku) problemas.push("linha sem SKU");
    else if (!produto) {
      problemas.push(achadoSku.ambiguo ? "SKU ambíguo" : "SKU não cadastrado");
    }
    if (!cliente) {
      // ambíguo é diferente de desconhecido: o nome casou com mais de um
      // cliente, e dizer "não cadastrado" mandaria cadastrar de novo o que já
      // existe duas vezes
      problemas.push(
        !nomeCliente
          ? "sem cliente"
          : achado.ambiguo
            ? "cliente ambíguo"
            : "cliente não cadastrado"
      );
    }
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
    linhasNoArquivo: todas.length - iCabecalho - 1,
    linhasVazias: vazias,
  };
}
