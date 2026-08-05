import { pool } from "../db/pool";
import { listarVendasFinanceiras } from "./financeiroService";

export interface MateriaPrima {
  id: number;
  nome: string;
  custoPorKg: number;
}

export interface FormulaItem {
  id: number;
  materiaPrimaId: number;
  materiaPrimaNome: string;
  custoPorKg: number;
  percentual: number;
}

export interface FormulaResumo {
  id: number;
  nome: string;
  sku: string | null;
  pesoLoteKg: number;
  custoEmbalagem: number;
  custoFabricacao: number;
}

export interface Formula extends FormulaResumo {
  itens: FormulaItem[];
}

export interface DadosMlSku {
  precoMedio: number;
  tarifaMedia: number;
  freteMedio: number;
  impostoMedio: number;
  qtdVendas: number;
}

// Mesma conta das planilhas de produção já usadas na fábrica: cada item
// vira massa (% do peso do lote) × custo por kg, somado dá o custo de
// fabricação; embalagem entra por fora (não é % da fórmula, é por unidade).
export function calcularCustoFormula(itens: { percentual: number; custoPorKg: number }[], pesoLoteKg: number): number {
  return itens.reduce((soma, item) => soma + (item.percentual / 100) * pesoLoteKg * item.custoPorKg, 0);
}

export async function listarMateriasPrimas(): Promise<MateriaPrima[]> {
  const { rows } = await pool.query<{ id: number; nome: string; custo_por_kg: string }>(
    "SELECT id, nome, custo_por_kg FROM materias_primas ORDER BY nome"
  );
  return rows.map((r) => ({ id: r.id, nome: r.nome, custoPorKg: Number(r.custo_por_kg) }));
}

export async function criarMateriaPrima(nome: string, custoPorKg: number): Promise<MateriaPrima> {
  const { rows } = await pool.query<{ id: number; nome: string; custo_por_kg: string }>(
    "INSERT INTO materias_primas (nome, custo_por_kg) VALUES ($1, $2) RETURNING id, nome, custo_por_kg",
    [nome, custoPorKg]
  );
  return { id: rows[0].id, nome: rows[0].nome, custoPorKg: Number(rows[0].custo_por_kg) };
}

export async function atualizarMateriaPrima(id: number, nome: string, custoPorKg: number): Promise<void> {
  await pool.query(
    "UPDATE materias_primas SET nome = $2, custo_por_kg = $3, atualizado_em = now() WHERE id = $1",
    [id, nome, custoPorKg]
  );
}

export async function excluirMateriaPrima(id: number): Promise<void> {
  await pool.query("DELETE FROM materias_primas WHERE id = $1", [id]);
}

export async function listarFormulas(): Promise<FormulaResumo[]> {
  const { rows } = await pool.query<{
    id: number;
    nome: string;
    sku: string | null;
    peso_lote_kg: string;
    custo_embalagem: string;
  }>("SELECT id, nome, sku, peso_lote_kg, custo_embalagem FROM formulas ORDER BY nome");

  const itensPorFormula = await obterItensPorFormula(rows.map((r) => r.id));

  return rows.map((r) => {
    const itens = itensPorFormula.get(r.id) ?? [];
    const pesoLoteKg = Number(r.peso_lote_kg);
    return {
      id: r.id,
      nome: r.nome,
      sku: r.sku,
      pesoLoteKg,
      custoEmbalagem: Number(r.custo_embalagem),
      custoFabricacao: calcularCustoFormula(itens, pesoLoteKg) + Number(r.custo_embalagem),
    };
  });
}

async function obterItensPorFormula(formulaIds: number[]): Promise<Map<number, FormulaItem[]>> {
  const mapa = new Map<number, FormulaItem[]>();
  if (formulaIds.length === 0) return mapa;

  const { rows } = await pool.query<{
    id: number;
    formula_id: number;
    materia_prima_id: number;
    materia_prima_nome: string;
    custo_por_kg: string;
    percentual: string;
  }>(
    `SELECT fi.id, fi.formula_id, fi.materia_prima_id, mp.nome AS materia_prima_nome, mp.custo_por_kg, fi.percentual
     FROM formula_itens fi
     JOIN materias_primas mp ON mp.id = fi.materia_prima_id
     WHERE fi.formula_id = ANY($1)
     ORDER BY fi.id`,
    [formulaIds]
  );

  for (const r of rows) {
    if (!mapa.has(r.formula_id)) mapa.set(r.formula_id, []);
    mapa.get(r.formula_id)!.push({
      id: r.id,
      materiaPrimaId: r.materia_prima_id,
      materiaPrimaNome: r.materia_prima_nome,
      custoPorKg: Number(r.custo_por_kg),
      percentual: Number(r.percentual),
    });
  }
  return mapa;
}

export async function obterFormula(id: number): Promise<Formula | null> {
  const { rows } = await pool.query<{
    id: number;
    nome: string;
    sku: string | null;
    peso_lote_kg: string;
    custo_embalagem: string;
  }>("SELECT id, nome, sku, peso_lote_kg, custo_embalagem FROM formulas WHERE id = $1", [id]);
  if (rows.length === 0) return null;

  const itensPorFormula = await obterItensPorFormula([id]);
  const itens = itensPorFormula.get(id) ?? [];
  const pesoLoteKg = Number(rows[0].peso_lote_kg);
  const custoEmbalagem = Number(rows[0].custo_embalagem);

  return {
    id: rows[0].id,
    nome: rows[0].nome,
    sku: rows[0].sku,
    pesoLoteKg,
    custoEmbalagem,
    custoFabricacao: calcularCustoFormula(itens, pesoLoteKg) + custoEmbalagem,
    itens,
  };
}

interface ItemEntrada {
  materiaPrimaId: number;
  percentual: number;
}

// Substitui a lista de itens inteira (delete + insert) em vez de tentar
// diffar item a item — a tela sempre manda a lista completa da fórmula,
// então não tem ganho em fazer diff, só complexidade a mais.
async function salvarItens(formulaId: number, itens: ItemEntrada[]): Promise<void> {
  await pool.query("DELETE FROM formula_itens WHERE formula_id = $1", [formulaId]);
  for (const item of itens) {
    await pool.query(
      "INSERT INTO formula_itens (formula_id, materia_prima_id, percentual) VALUES ($1, $2, $3)",
      [formulaId, item.materiaPrimaId, item.percentual]
    );
  }
}

export async function criarFormula(
  nome: string,
  sku: string | null,
  pesoLoteKg: number,
  custoEmbalagem: number,
  itens: ItemEntrada[]
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    "INSERT INTO formulas (nome, sku, peso_lote_kg, custo_embalagem) VALUES ($1, $2, $3, $4) RETURNING id",
    [nome, sku, pesoLoteKg, custoEmbalagem]
  );
  await salvarItens(rows[0].id, itens);
  return rows[0].id;
}

export async function atualizarFormula(
  id: number,
  nome: string,
  sku: string | null,
  pesoLoteKg: number,
  custoEmbalagem: number,
  itens: ItemEntrada[]
): Promise<void> {
  await pool.query(
    "UPDATE formulas SET nome = $2, sku = $3, peso_lote_kg = $4, custo_embalagem = $5, atualizado_em = now() WHERE id = $1",
    [id, nome, sku, pesoLoteKg, custoEmbalagem]
  );
  await salvarItens(id, itens);
}

export async function excluirFormula(id: number): Promise<void> {
  await pool.query("DELETE FROM formulas WHERE id = $1", [id]);
}

const DIAS_JANELA_ML = 30;

function dataISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Puxa preço/tarifa/frete/imposto médios por unidade vendida desse SKU nos
// últimos 30 dias — reaproveita 100% o cálculo que o Financeiro já faz
// (listarVendasFinanceiras), sem chamada nova ao Mercado Livre nem
// duplicar lógica de custo/tarifa/frete. Cada "Total" que vem de lá já é
// por linha de venda (valor × quantidade), por isso divide pela
// quantidade pra virar "por unidade" antes de tirar a média.
export async function obterDadosMlPorSku(
  sku: string,
  lojaIdFiltro?: number,
  lojasPermitidas?: number[]
): Promise<DadosMlSku> {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - DIAS_JANELA_ML * 24 * 60 * 60 * 1000);

  const { vendas } = await listarVendasFinanceiras(lojaIdFiltro, lojasPermitidas, dataISO(inicio), dataISO(hoje));
  const doSku = vendas.filter((v) => v.sku === sku);

  if (doSku.length === 0) {
    return { precoMedio: 0, tarifaMedia: 0, freteMedio: 0, impostoMedio: 0, qtdVendas: 0 };
  }

  let unidades = 0;
  let receita = 0;
  let tarifa = 0;
  let frete = 0;
  let imposto = 0;
  for (const v of doSku) {
    unidades += v.quantidade;
    receita += v.receitaTotal;
    tarifa += v.taxaMlTotal;
    frete += v.freteVendedorTotal ?? 0;
    imposto += v.impostoTotal;
  }

  return {
    precoMedio: receita / unidades,
    tarifaMedia: tarifa / unidades,
    freteMedio: frete / unidades,
    impostoMedio: imposto / unidades,
    qtdVendas: doSku.length,
  };
}
