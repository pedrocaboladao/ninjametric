import ExcelJS from "exceljs";
import { listarProdutos } from "./fabricaProdutosService";

// Exporta o catálogo da Fábrica pra .xlsx.
//
// Existe porque não havia jeito de tirar a lista do sistema: a tela mostra os
// produtos e o filtro, mas quem precisa conferir preço com fornecedor, mandar
// pro contador ou cruzar com planilha ficava copiando na mão.
//
// Fábrica e distribuição saem na mesma aba, com a coluna ORIGEM separando —
// é como o catálogo é olhado na prática, e ter duas abas obrigaria a somar
// duas vezes pra saber o total. O filtro do Excel resolve o resto.

export interface FiltroExport {
  origem?: "FABRICA" | "DISTRIBUIDORA";
  // por padrão vai tudo: produto desativado ainda aparece em pedido antigo, e
  // quem exporta pra conferir histórico precisa dele
  somenteAtivos?: boolean;
}

const CABECALHO: Array<{ titulo: string; largura: number }> = [
  { titulo: "ORIGEM", largura: 15 },
  // revenda vira anúncio no Mercado Livre; insumo a expedição consome. Sem essa
  // coluna a conferência contra o SKU MASTER cobra insumo que nunca vai estar lá
  { titulo: "TIPO", largura: 12 },
  { titulo: "SKU", largura: 38 },
  { titulo: "PRODUTO", largura: 40 },
  { titulo: "FAMÍLIA", largura: 24 },
  { titulo: "CUSTO", largura: 14 },
  { titulo: "VENDA", largura: 14 },
  { titulo: "MARGEM R$", largura: 14 },
  { titulo: "MARGEM %", largura: 12 },
  { titulo: "ATIVO", largura: 9 },
  { titulo: "FÓRMULA", largura: 30 },
  { titulo: "EMBALAGEM", largura: 26 },
  { titulo: "PESO KG", largura: 10 },
  { titulo: "O QUE FALTA NO CADASTRO", largura: 44 },
];

export async function exportarProdutos(filtro: FiltroExport = {}): Promise<Buffer> {
  const todos = await listarProdutos();
  const produtos = todos.filter(
    (p) =>
      (!filtro.origem || p.origem === filtro.origem) &&
      (!filtro.somenteAtivos || p.ativo)
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = "Impetrus Vision";
  wb.created = new Date();
  const ws = wb.addWorksheet("CATÁLOGO");

  ws.columns = CABECALHO.map((c) => ({ header: c.titulo, width: c.largura }));
  const cab = ws.getRow(1);
  cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  cab.alignment = { horizontal: "center", vertical: "middle" };
  cab.height = 22;

  for (const p of produtos) {
    ws.addRow([
      p.origem === "FABRICA" ? "Fábrica" : "Distribuição",
      p.tipo === "INSUMO" ? "Insumo" : "Revenda",
      p.sku,
      p.nome,
      p.familia ?? "",
      p.custo,
      p.precoVenda,
      p.margemContribuicao,
      // percentualLucro vem em fração; a planilha formata como porcentagem
      p.percentualLucro,
      p.ativo ? "sim" : "não",
      p.formulaNome ?? "",
      p.embalagemNome ?? "",
      p.pesoKg || "",
      p.semCusto.join(" · "),
    ]);
  }

  const fim = produtos.length + 1;
  ws.getColumn(5).numFmt = "R$ #,##0.00";
  ws.getColumn(6).numFmt = "R$ #,##0.00";
  ws.getColumn(7).numFmt = "R$ #,##0.00";
  ws.getColumn(8).numFmt = "0.0%";
  ws.getColumn(12).numFmt = "0.000";
  ws.views = [{ state: "frozen", ySplit: 1 }];
  if (fim > 1) ws.autoFilter = { from: "A1", to: { row: fim, column: CABECALHO.length } };

  // custo zerado é cadastro pela metade, não margem de 100%: pinta a linha pra
  // não passar despercebido no meio de cinco mil
  for (let r = 2; r <= fim; r++) {
    if (String(ws.getRow(r).getCell(13).value ?? "")) {
      ws.getRow(r).getCell(5).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFF2CC" },
      };
    }
  }

  const resumo = wb.addWorksheet("RESUMO");
  resumo.columns = [
    { header: "", width: 30 },
    { header: "PRODUTOS", width: 13 },
    { header: "CUSTO TOTAL", width: 18 },
    { header: "VENDA TOTAL", width: 18 },
    { header: "MARGEM MÉDIA", width: 16 },
    { header: "SEM CUSTO", width: 13 },
  ];
  const cabR = resumo.getRow(1);
  cabR.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cabR.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };

  const grupo = (rotulo: string, lista: typeof produtos) => {
    const venda = lista.reduce((s, p) => s + p.precoVenda, 0);
    const custo = lista.reduce((s, p) => s + p.custo, 0);
    const linha = resumo.addRow([
      rotulo,
      lista.length,
      custo,
      venda,
      venda > 0 ? (venda - custo) / venda : 0,
      lista.filter((p) => p.semCusto.length).length,
    ]);
    linha.getCell(3).numFmt = "R$ #,##0.00";
    linha.getCell(4).numFmt = "R$ #,##0.00";
    linha.getCell(5).numFmt = "0.0%";
  };
  grupo("Fábrica", produtos.filter((p) => p.origem === "FABRICA"));
  grupo("Distribuição", produtos.filter((p) => p.origem !== "FABRICA"));
  grupo("TOTAL", produtos);
  resumo.getRow(resumo.rowCount).font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
