import ExcelJS from "exceljs";

// Lê um arquivo de planilha e devolve o texto separado por tab, no formato que
// conferirPlanilhaVendas já entende.
//
// Antes só dava pra colar as linhas na tela. Colar funciona para o relatório
// de umas centenas de linhas, mas o fechamento de um mês passa de duas mil —
// e aí o navegador engasga, o operador perde o meio do caminho e ninguém
// descobre qual linha ficou de fora.
//
// Converter aqui em vez de criar um segundo caminho de importação é de
// propósito: a conferência, o casamento de SKU e a trava de duplicidade
// continuam sendo os mesmos, e arquivo e texto colado nunca divergem.

function texto(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${d}/${m}/${v.getFullYear()}`;
  }
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: Array<{ text: string }> };
    if (typeof o.text === "string") return o.text;
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("");
    if (o.result !== undefined) return texto(o.result);
  }
  return String(v);
}

// tab é o separador de saída, então tab dentro da célula viraria coluna nova
const limpa = (s: string) => s.replace(/[\t\r\n]+/g, " ").trim();

export async function planilhaParaTexto(buffer: Buffer, nome: string): Promise<string> {
  const ext = (nome.split(".").pop() ?? "").toLowerCase();

  if (ext === "csv" || ext === "tsv" || ext === "txt") {
    // o arquivo pode vir com BOM do Excel; deixá-lo derruba o primeiro
    // cabeçalho, e o operador vê "coluna Cliente não encontrada"
    return buffer.toString("utf8").replace(/^﻿/, "");
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("A planilha veio sem nenhuma aba.");

  const linhas: string[] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cols: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      cols.push(limpa(texto(row.getCell(c).value)));
    }
    // linha em branco vira linha em branco, não desaparece: o conferidor conta
    // as vazias e mostra o número, que é como se confere o total contra o Excel
    linhas.push(cols.join("\t"));
  }
  return linhas.join("\n");
}
