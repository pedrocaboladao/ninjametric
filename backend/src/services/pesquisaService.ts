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
