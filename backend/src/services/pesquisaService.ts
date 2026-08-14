import ExcelJS from "exceljs";
import { pool } from "../db/pool";

export interface PesquisaCategoria {
  id: number;
  nome: string;
}

export interface PesquisaRankingLinha {
  id: number;
  vendedor: string;
  qtde: number;
  totalReais: number;
  participacaoPercentual: number;
}

export interface LancamentoEntrada {
  vendedor: string;
  qtde: number;
  totalReais: number;
}

export interface PesquisaEvolucaoSerie {
  vendedor: string;
  valores: (number | null)[];
}

export interface PesquisaEvolucao {
  meses: string[];
  totalMercadoPorMes: number[];
  series: PesquisaEvolucaoSerie[];
}

function mesParaData(mes: string): string {
  // aceita "YYYY-MM" ou "YYYY-MM-DD", sempre normaliza pro dia 1
  const [ano, mesNum] = mes.split("-");
  if (!ano || !mesNum) throw new Error("Mês inválido");
  return `${ano}-${mesNum.padStart(2, "0")}-01`;
}

export async function listarCategorias(): Promise<PesquisaCategoria[]> {
  const { rows } = await pool.query("SELECT id, nome FROM pesquisa_categorias ORDER BY nome");
  return rows;
}

export async function criarCategoria(nome: string): Promise<PesquisaCategoria> {
  const { rows } = await pool.query(
    "INSERT INTO pesquisa_categorias (nome) VALUES ($1) RETURNING id, nome",
    [nome]
  );
  return rows[0];
}

export async function excluirCategoria(id: number): Promise<void> {
  await pool.query("DELETE FROM pesquisa_categorias WHERE id = $1", [id]);
}

export async function listarMeses(categoriaId: number): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT to_char(mes, 'YYYY-MM-DD') AS mes FROM pesquisa_mercado
     WHERE categoria_id = $1 ORDER BY mes DESC`,
    [categoriaId]
  );
  return rows.map((r) => r.mes);
}

export async function listarRanking(categoriaId: number, mes: string): Promise<PesquisaRankingLinha[]> {
  const dataMes = mesParaData(mes);
  const { rows } = await pool.query(
    `SELECT id, vendedor, qtde, total_reais FROM pesquisa_mercado
     WHERE categoria_id = $1 AND mes = $2
     ORDER BY total_reais DESC`,
    [categoriaId, dataMes]
  );
  const totalMercado = rows.reduce((soma, r) => soma + Number(r.total_reais), 0);
  return rows.map((r) => ({
    id: r.id,
    vendedor: r.vendedor,
    qtde: Number(r.qtde),
    totalReais: Number(r.total_reais),
    participacaoPercentual: totalMercado > 0 ? (Number(r.total_reais) / totalMercado) * 100 : 0,
  }));
}

export async function salvarLancamentosDoMes(
  categoriaId: number,
  mes: string,
  linhas: LancamentoEntrada[]
): Promise<void> {
  const dataMes = mesParaData(mes);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const vendedores = linhas.map((l) => l.vendedor);
    if (vendedores.length > 0) {
      await client.query(
        `DELETE FROM pesquisa_mercado WHERE categoria_id = $1 AND mes = $2 AND vendedor != ALL($3::text[])`,
        [categoriaId, dataMes, vendedores]
      );
    } else {
      await client.query(`DELETE FROM pesquisa_mercado WHERE categoria_id = $1 AND mes = $2`, [categoriaId, dataMes]);
    }
    for (const linha of linhas) {
      await client.query(
        `INSERT INTO pesquisa_mercado (categoria_id, mes, vendedor, qtde, total_reais, atualizado_em)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (categoria_id, mes, vendedor)
         DO UPDATE SET qtde = EXCLUDED.qtde, total_reais = EXCLUDED.total_reais, atualizado_em = now()`,
        [categoriaId, dataMes, linha.vendedor, linha.qtde, linha.totalReais]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function excluirLancamento(id: number): Promise<void> {
  await pool.query("DELETE FROM pesquisa_mercado WHERE id = $1", [id]);
}

const TOP_VENDEDORES_EVOLUCAO = 8;

export async function obterEvolucao(categoriaId: number): Promise<PesquisaEvolucao> {
  const { rows } = await pool.query(
    `SELECT to_char(mes, 'YYYY-MM-DD') AS mes, vendedor, total_reais FROM pesquisa_mercado
     WHERE categoria_id = $1 ORDER BY mes ASC`,
    [categoriaId]
  );

  const meses = Array.from(new Set(rows.map((r) => r.mes))) as string[];

  const totalPorVendedor = new Map<string, number>();
  for (const r of rows) {
    totalPorVendedor.set(r.vendedor, (totalPorVendedor.get(r.vendedor) ?? 0) + Number(r.total_reais));
  }
  const vendedoresOrdenados = [...totalPorVendedor.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_VENDEDORES_EVOLUCAO)
    .map(([vendedor]) => vendedor);

  const valorPorMesVendedor = new Map<string, number>();
  const totalMercadoPorMes = new Map<string, number>();
  for (const r of rows) {
    valorPorMesVendedor.set(`${r.mes}|${r.vendedor}`, Number(r.total_reais));
    totalMercadoPorMes.set(r.mes, (totalMercadoPorMes.get(r.mes) ?? 0) + Number(r.total_reais));
  }

  const series: PesquisaEvolucaoSerie[] = vendedoresOrdenados.map((vendedor) => ({
    vendedor,
    valores: meses.map((mes) => valorPorMesVendedor.get(`${mes}|${vendedor}`) ?? null),
  }));

  return {
    meses,
    totalMercadoPorMes: meses.map((mes) => totalMercadoPorMes.get(mes) ?? 0),
    series,
  };
}

export interface ResumoImportacaoPlanilha {
  categoria: string;
  criada: boolean;
  linhas: number;
  meses: number;
}

function corrigirMojibake(valor: string): string {
  const limpo = valor.replace(/ /g, " ").trim();
  const corrigido = Buffer.from(limpo, "latin1").toString("utf8");
  return corrigido.includes("�") ? limpo : corrigido;
}

function celulaParaValor(cell: ExcelJS.Cell): unknown {
  const v = cell.value as unknown;
  if (v && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if ("result" in obj) return obj.result;
    if ("text" in obj) return obj.text; // célula com hyperlink: { text, hyperlink }
    if ("richText" in obj && Array.isArray(obj.richText)) {
      return (obj.richText as { text: string }[]).map((p) => p.text).join("");
    }
  }
  return v;
}

function paraNumero(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function ordAnoMes(d: Date): number {
  return d.getFullYear() * 12 + d.getMonth();
}

export async function importarPlanilha(buffer: Buffer): Promise<ResumoImportacaoPlanilha[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const resumo: ResumoImportacaoPlanilha[] = [];

  for (const worksheet of workbook.worksheets) {
    const nomeCategoria = corrigirMojibake(worksheet.name);
    const numColunas = worksheet.columnCount;
    const numLinhas = worksheet.rowCount;
    if (numLinhas < 3 || numColunas < 3) continue;

    const linhaDatas = worksheet.getRow(1);
    const linhaRotulos = worksheet.getRow(2);

    type Bloco = { col: number; data: Date };
    const blocos: Bloco[] = [];
    for (let col = 1; col <= numColunas; col++) {
      const valorData = celulaParaValor(linhaDatas.getCell(col));
      if (valorData instanceof Date) {
        const rotulo = celulaParaValor(linhaRotulos.getCell(col));
        if (typeof rotulo === "string" && rotulo.trim().toLowerCase().startsWith("vendedor")) {
          blocos.push({ col, data: valorData });
        }
      }
    }
    if (blocos.length === 0) continue;

    // corrige erros de digitação de ano no cabeçalho reconstruindo a
    // sequência a partir do MÊS (sempre consecutivo/crescente nessas
    // planilhas), ignorando o ano gravado exceto no primeiro bloco
    let anoAtual = blocos[0].data.getFullYear();
    let mesAnterior: number | null = null;
    for (const bloco of blocos) {
      const mes = bloco.data.getMonth();
      if (mesAnterior !== null && mes <= mesAnterior) anoAtual++;
      mesAnterior = mes;
      bloco.data = new Date(anoAtual, mes, 1);
    }

    const agregado = new Map<string, { mes: string; vendedor: string; qtde: number; totalReais: number }>();
    for (const bloco of blocos) {
      const mes = `${bloco.data.getFullYear()}-${String(bloco.data.getMonth() + 1).padStart(2, "0")}`;
      for (let r = 3; r <= numLinhas; r++) {
        const row = worksheet.getRow(r);
        const vendedorBruto = celulaParaValor(row.getCell(bloco.col));
        if (typeof vendedorBruto !== "string" || !vendedorBruto.trim()) continue;
        const qtde = paraNumero(celulaParaValor(row.getCell(bloco.col + 1)));
        const total = paraNumero(celulaParaValor(row.getCell(bloco.col + 2)));
        if (qtde === null || total === null) continue;
        const vendedor = corrigirMojibake(vendedorBruto);
        if (!vendedor) continue;
        const chave = `${mes}|${vendedor}`;
        const atual = agregado.get(chave);
        if (atual) {
          atual.qtde += qtde;
          atual.totalReais += total;
        } else {
          agregado.set(chave, { mes, vendedor, qtde, totalReais: total });
        }
      }
    }

    if (agregado.size === 0) continue;

    const { rows: existentes } = await pool.query("SELECT id FROM pesquisa_categorias WHERE nome = $1", [nomeCategoria]);
    let categoriaId: number;
    let criada = false;
    if (existentes.length > 0) {
      categoriaId = existentes[0].id;
    } else {
      const nova = await criarCategoria(nomeCategoria);
      categoriaId = nova.id;
      criada = true;
    }

    const porMes = new Map<string, LancamentoEntrada[]>();
    for (const linha of agregado.values()) {
      if (!porMes.has(linha.mes)) porMes.set(linha.mes, []);
      porMes.get(linha.mes)!.push({ vendedor: linha.vendedor, qtde: linha.qtde, totalReais: linha.totalReais });
    }
    for (const [mes, linhas] of porMes) {
      await salvarLancamentosDoMes(categoriaId, mes, linhas);
    }

    resumo.push({ categoria: nomeCategoria, criada, linhas: agregado.size, meses: porMes.size });
  }

  return resumo;
}
