import { pool } from "../db/pool";
import { listarVendasFinanceiras } from "./financeiroService";

export interface MateriaPrima {
  id: number;
  nome: string;
  custoPorKg: number;
}

export interface MateriaPrimaCompra {
  id: number;
  materiaPrimaId: number;
  data: string;
  quantidadeKg: number;
  valorPago: number;
  valorFrete: number;
  custoPorKg: number;
  criadoEm: string;
}

export interface FormulaItem {
  id: number;
  tipo: "materia_prima" | "formula";
  materiaPrimaId: number | null;
  materiaPrimaNome: string | null;
  subFormulaId: number | null;
  subFormulaNome: string | null;
  custoPorKg: number;
  percentual: number;
}

export interface FormulaEmbalagem {
  id: number;
  formulaId: number;
  nome: string;
  pesoKg: number;
  custoEmbalagem: number;
  sku: string | null;
  ordem: number;
  custoProduto: number;
  custoFinal: number;
}

export interface FormulaLote {
  id: number;
  formulaId: number;
  data: string;
  pesoPrevistoKg: number;
  pesoRealKg: number;
  observacao: string | null;
  diferencaKg: number;
  diferencaPercentual: number | null;
  criadoEm: string;
}

export interface FormulaResumo {
  id: number;
  nome: string;
  pesoLoteKg: number;
  custoPorKg: number;
  custoFabricacaoTotal: number;
  subFormulaIds: number[];
}

export interface Formula extends FormulaResumo {
  itens: FormulaItem[];
  embalagens: FormulaEmbalagem[];
}

export interface DadosMlSku {
  precoMedio: number;
  tarifaMedia: number;
  freteMedio: number;
  impostoMedio: number;
  qtdVendas: number;
}

// pg devolve colunas DATE como objeto Date (meia-noite UTC) — sem isso, o
// JSON.stringify vira um timestamp ISO completo em vez de "AAAA-MM-DD".
function dataParaISO(valor: unknown): string {
  return valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor).slice(0, 10);
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

function mapearCompra(r: {
  id: number;
  materia_prima_id: number;
  data: string;
  quantidade_kg: string;
  valor_pago: string;
  valor_frete: string;
  custo_por_kg: string;
  criado_em: string;
}): MateriaPrimaCompra {
  return {
    id: r.id,
    materiaPrimaId: r.materia_prima_id,
    data: dataParaISO(r.data),
    quantidadeKg: Number(r.quantidade_kg),
    valorPago: Number(r.valor_pago),
    valorFrete: Number(r.valor_frete),
    custoPorKg: Number(r.custo_por_kg),
    criadoEm: r.criado_em,
  };
}

export async function listarComprasMateriaPrima(materiaPrimaId: number, limite = 10): Promise<MateriaPrimaCompra[]> {
  const { rows } = await pool.query<{
    id: number;
    materia_prima_id: number;
    data: string;
    quantidade_kg: string;
    valor_pago: string;
    valor_frete: string;
    custo_por_kg: string;
    criado_em: string;
  }>(
    `SELECT id, materia_prima_id, data, quantidade_kg, valor_pago, valor_frete, custo_por_kg, criado_em
     FROM materia_prima_compras WHERE materia_prima_id = $1 ORDER BY data DESC, id DESC LIMIT $2`,
    [materiaPrimaId, limite]
  );
  return rows.map(mapearCompra);
}

// Registrar uma compra recalcula o custo/kg (valor pago + frete, dividido
// pela quantidade) e já atualiza materias_primas.custo_por_kg pra esse
// valor — é o jeito "oficial" de manter o custo em dia; a edição manual do
// campo continua existindo em paralelo pra ajustes rápidos.
export async function registrarCompraMateriaPrima(
  materiaPrimaId: number,
  data: string,
  quantidadeKg: number,
  valorPago: number,
  valorFrete: number
): Promise<MateriaPrimaCompra> {
  const custoPorKg = (valorPago + valorFrete) / quantidadeKg;
  const { rows } = await pool.query<{
    id: number;
    materia_prima_id: number;
    data: string;
    quantidade_kg: string;
    valor_pago: string;
    valor_frete: string;
    custo_por_kg: string;
    criado_em: string;
  }>(
    `INSERT INTO materia_prima_compras (materia_prima_id, data, quantidade_kg, valor_pago, valor_frete, custo_por_kg)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, materia_prima_id, data, quantidade_kg, valor_pago, valor_frete, custo_por_kg, criado_em`,
    [materiaPrimaId, data, quantidadeKg, valorPago, valorFrete, custoPorKg]
  );
  await pool.query("UPDATE materias_primas SET custo_por_kg = $2, atualizado_em = now() WHERE id = $1", [
    materiaPrimaId,
    custoPorKg,
  ]);
  return mapearCompra(rows[0]);
}

// Editar uma compra recalcula o custo/kg dela e também atualiza
// materias_primas.custo_por_kg — mesmo efeito de registrar de novo, já
// que editar é "corrigir o que devia ter sido digitado da primeira vez".
export async function atualizarCompraMateriaPrima(
  id: number,
  data: string,
  quantidadeKg: number,
  valorPago: number,
  valorFrete: number
): Promise<MateriaPrimaCompra> {
  const custoPorKg = (valorPago + valorFrete) / quantidadeKg;
  const { rows } = await pool.query<{
    id: number;
    materia_prima_id: number;
    data: string;
    quantidade_kg: string;
    valor_pago: string;
    valor_frete: string;
    custo_por_kg: string;
    criado_em: string;
  }>(
    `UPDATE materia_prima_compras
     SET data = $2, quantidade_kg = $3, valor_pago = $4, valor_frete = $5, custo_por_kg = $6
     WHERE id = $1
     RETURNING id, materia_prima_id, data, quantidade_kg, valor_pago, valor_frete, custo_por_kg, criado_em`,
    [id, data, quantidadeKg, valorPago, valorFrete, custoPorKg]
  );
  if (rows.length === 0) throw new Error("Compra não encontrada.");
  await pool.query("UPDATE materias_primas SET custo_por_kg = $2, atualizado_em = now() WHERE id = $1", [
    rows[0].materia_prima_id,
    custoPorKg,
  ]);
  return mapearCompra(rows[0]);
}

// Excluir uma compra não mexe no custo/kg atual da matéria-prima (evita
// ambiguidade sobre qual compra restante "deveria" virar o novo custo) —
// se precisar ajustar depois, dá pra editar o custo/kg direto no card.
export async function excluirCompraMateriaPrima(id: number): Promise<void> {
  await pool.query("DELETE FROM materia_prima_compras WHERE id = $1", [id]);
}

interface ItemBruto {
  id: number;
  formulaId: number;
  materiaPrimaId: number | null;
  materiaPrimaNome: string | null;
  materiaPrimaCustoPorKg: number | null;
  subFormulaId: number | null;
  subFormulaNome: string | null;
  percentual: number;
}

async function buscarTodosItens(): Promise<ItemBruto[]> {
  const { rows } = await pool.query<{
    id: number;
    formula_id: number;
    materia_prima_id: number | null;
    materia_prima_nome: string | null;
    materia_prima_custo_por_kg: string | null;
    sub_formula_id: number | null;
    sub_formula_nome: string | null;
    percentual: string;
  }>(
    `SELECT fi.id, fi.formula_id, fi.materia_prima_id, mp.nome AS materia_prima_nome, mp.custo_por_kg AS materia_prima_custo_por_kg,
            fi.sub_formula_id, sf.nome AS sub_formula_nome, fi.percentual
     FROM formula_itens fi
     LEFT JOIN materias_primas mp ON mp.id = fi.materia_prima_id
     LEFT JOIN formulas sf ON sf.id = fi.sub_formula_id
     ORDER BY fi.id`
  );
  return rows.map((r) => ({
    id: r.id,
    formulaId: r.formula_id,
    materiaPrimaId: r.materia_prima_id,
    materiaPrimaNome: r.materia_prima_nome,
    materiaPrimaCustoPorKg: r.materia_prima_custo_por_kg !== null ? Number(r.materia_prima_custo_por_kg) : null,
    subFormulaId: r.sub_formula_id,
    subFormulaNome: r.sub_formula_nome,
    percentual: Number(r.percentual),
  }));
}

function agruparPorFormula(itens: ItemBruto[]): Map<number, ItemBruto[]> {
  const mapa = new Map<number, ItemBruto[]>();
  for (const item of itens) {
    if (!mapa.has(item.formulaId)) mapa.set(item.formulaId, []);
    mapa.get(item.formulaId)!.push(item);
  }
  return mapa;
}

// Custo por kg de cada fórmula = soma de (percentual% × custo/kg de cada
// item), onde o item pode ser matéria-prima direta OU outra fórmula (custo
// dela calculado recursivamente aqui mesmo) — é assim que "custo da cor =
// custo da Base usada + custo da pigmentação" fica automático. emCalculo
// evita loop infinito se por algum motivo um ciclo escapar da validação de
// escrita (não deveria acontecer, mas não trava o cálculo se acontecer).
function calcularCustoPorKgTodasFormulas(
  formulaIds: number[],
  itensPorFormula: Map<number, ItemBruto[]>
): Map<number, number> {
  const custoCache = new Map<number, number>();
  const emCalculo = new Set<number>();

  function custoDe(formulaId: number): number {
    if (custoCache.has(formulaId)) return custoCache.get(formulaId)!;
    if (emCalculo.has(formulaId)) return 0;
    emCalculo.add(formulaId);
    let custo = 0;
    for (const item of itensPorFormula.get(formulaId) ?? []) {
      const fracao = item.percentual / 100;
      if (item.materiaPrimaId !== null) {
        custo += fracao * (item.materiaPrimaCustoPorKg ?? 0);
      } else if (item.subFormulaId !== null) {
        custo += fracao * custoDe(item.subFormulaId);
      }
    }
    emCalculo.delete(formulaId);
    custoCache.set(formulaId, custo);
    return custo;
  }

  for (const id of formulaIds) custoDe(id);
  return custoCache;
}

export async function listarFormulas(): Promise<FormulaResumo[]> {
  const { rows } = await pool.query<{ id: number; nome: string; peso_lote_kg: string }>(
    "SELECT id, nome, peso_lote_kg FROM formulas ORDER BY nome"
  );
  const itensPorFormula = agruparPorFormula(await buscarTodosItens());
  const custoPorKgMap = calcularCustoPorKgTodasFormulas(
    rows.map((r) => r.id),
    itensPorFormula
  );

  return rows.map((r) => {
    const pesoLoteKg = Number(r.peso_lote_kg);
    const custoPorKg = custoPorKgMap.get(r.id) ?? 0;
    // IDs das fórmulas que ESTA usa como ingrediente (ex.: uma cor aponta
    // pra sua Base) — o frontend usa isso pra agrupar cores dentro da Base
    // delas em vez de mostrar tudo numa lista só.
    const subFormulaIds = (itensPorFormula.get(r.id) ?? [])
      .filter((item) => item.subFormulaId !== null)
      .map((item) => item.subFormulaId!);
    return {
      id: r.id,
      nome: r.nome,
      pesoLoteKg,
      custoPorKg,
      custoFabricacaoTotal: custoPorKg * pesoLoteKg,
      subFormulaIds,
    };
  });
}

export async function obterFormula(id: number): Promise<Formula | null> {
  const { rows } = await pool.query<{ id: number; nome: string; peso_lote_kg: string }>(
    "SELECT id, nome, peso_lote_kg FROM formulas WHERE id = $1",
    [id]
  );
  if (rows.length === 0) return null;

  // Precisa do custo de TODAS as fórmulas (não só desta) pra resolver
  // sub-fórmulas aninhadas em qualquer profundidade.
  const [todasFormulas, itensBrutos, embalagensRes] = await Promise.all([
    pool.query<{ id: number }>("SELECT id FROM formulas"),
    buscarTodosItens(),
    pool.query<{
      id: number;
      formula_id: number;
      nome: string;
      peso_kg: string;
      custo_embalagem: string;
      sku: string | null;
      ordem: number;
    }>(
      "SELECT id, formula_id, nome, peso_kg, custo_embalagem, sku, ordem FROM formula_embalagens WHERE formula_id = $1 ORDER BY ordem, id",
      [id]
    ),
  ]);

  const itensPorFormula = agruparPorFormula(itensBrutos);
  const custoPorKgMap = calcularCustoPorKgTodasFormulas(
    todasFormulas.rows.map((r) => r.id),
    itensPorFormula
  );

  const pesoLoteKg = Number(rows[0].peso_lote_kg);
  const custoPorKg = custoPorKgMap.get(id) ?? 0;

  const itens: FormulaItem[] = (itensPorFormula.get(id) ?? []).map((item) => ({
    id: item.id,
    tipo: item.materiaPrimaId !== null ? "materia_prima" : "formula",
    materiaPrimaId: item.materiaPrimaId,
    materiaPrimaNome: item.materiaPrimaNome,
    subFormulaId: item.subFormulaId,
    subFormulaNome: item.subFormulaNome,
    custoPorKg: item.materiaPrimaId !== null ? item.materiaPrimaCustoPorKg ?? 0 : custoPorKgMap.get(item.subFormulaId!) ?? 0,
    percentual: item.percentual,
  }));

  const embalagens: FormulaEmbalagem[] = embalagensRes.rows.map((e) => {
    const pesoKg = Number(e.peso_kg);
    const custoEmbalagem = Number(e.custo_embalagem);
    const custoProduto = custoPorKg * pesoKg;
    return {
      id: e.id,
      formulaId: e.formula_id,
      nome: e.nome,
      pesoKg,
      custoEmbalagem,
      sku: e.sku,
      ordem: e.ordem,
      custoProduto,
      custoFinal: custoProduto + custoEmbalagem,
    };
  });

  return {
    id,
    nome: rows[0].nome,
    pesoLoteKg,
    custoPorKg,
    custoFabricacaoTotal: custoPorKg * pesoLoteKg,
    subFormulaIds: itens.filter((i) => i.subFormulaId !== null).map((i) => i.subFormulaId!),
    itens,
    embalagens,
  };
}

export interface ItemEntrada {
  materiaPrimaId: number | null;
  subFormulaId: number | null;
  percentual: number;
}

export interface EmbalagemEntrada {
  nome: string;
  pesoKg: number;
  custoEmbalagem: number;
  sku: string | null;
}

// Retorna true se "formulaId" depende (direta ou indiretamente) de "alvoId"
// — usado pra bloquear ciclo (fórmula A usando fórmula B que usa A) antes
// de salvar, já que o banco não tem como impedir isso sozinho.
async function formulaDependeDe(formulaId: number, alvoId: number, visitados = new Set<number>()): Promise<boolean> {
  if (formulaId === alvoId) return true;
  if (visitados.has(formulaId)) return false;
  visitados.add(formulaId);
  const { rows } = await pool.query<{ sub_formula_id: number }>(
    "SELECT sub_formula_id FROM formula_itens WHERE formula_id = $1 AND sub_formula_id IS NOT NULL",
    [formulaId]
  );
  for (const r of rows) {
    if (await formulaDependeDe(r.sub_formula_id, alvoId, visitados)) return true;
  }
  return false;
}

async function validarSemCiclo(formulaId: number, itens: ItemEntrada[]): Promise<void> {
  for (const item of itens) {
    if (item.subFormulaId === null) continue;
    if (item.subFormulaId === formulaId) {
      throw new Error("Uma fórmula não pode usar a si mesma como ingrediente.");
    }
    if (await formulaDependeDe(item.subFormulaId, formulaId)) {
      throw new Error(
        "Isso criaria um ciclo: a fórmula que você quer usar como ingrediente já depende (direta ou indiretamente) desta fórmula."
      );
    }
  }
}

async function salvarItens(formulaId: number, itens: ItemEntrada[]): Promise<void> {
  await pool.query("DELETE FROM formula_itens WHERE formula_id = $1", [formulaId]);
  for (const item of itens) {
    await pool.query(
      "INSERT INTO formula_itens (formula_id, materia_prima_id, sub_formula_id, percentual) VALUES ($1, $2, $3, $4)",
      [formulaId, item.materiaPrimaId, item.subFormulaId, item.percentual]
    );
  }
}

async function salvarEmbalagens(formulaId: number, embalagens: EmbalagemEntrada[]): Promise<void> {
  await pool.query("DELETE FROM formula_embalagens WHERE formula_id = $1", [formulaId]);
  let ordem = 0;
  for (const e of embalagens) {
    await pool.query(
      "INSERT INTO formula_embalagens (formula_id, nome, peso_kg, custo_embalagem, sku, ordem) VALUES ($1, $2, $3, $4, $5, $6)",
      [formulaId, e.nome, e.pesoKg, e.custoEmbalagem, e.sku, ordem++]
    );
  }
}

export async function criarFormula(
  nome: string,
  pesoLoteKg: number,
  itens: ItemEntrada[],
  embalagens: EmbalagemEntrada[]
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    "INSERT INTO formulas (nome, peso_lote_kg) VALUES ($1, $2) RETURNING id",
    [nome, pesoLoteKg]
  );
  await salvarItens(rows[0].id, itens);
  await salvarEmbalagens(rows[0].id, embalagens);
  return rows[0].id;
}

export async function atualizarFormula(
  id: number,
  nome: string,
  pesoLoteKg: number,
  itens: ItemEntrada[],
  embalagens: EmbalagemEntrada[]
): Promise<void> {
  await validarSemCiclo(id, itens);
  await pool.query("UPDATE formulas SET nome = $2, peso_lote_kg = $3, atualizado_em = now() WHERE id = $1", [
    id,
    nome,
    pesoLoteKg,
  ]);
  await salvarItens(id, itens);
  await salvarEmbalagens(id, embalagens);
}

export async function excluirFormula(id: number): Promise<void> {
  await pool.query("DELETE FROM formulas WHERE id = $1", [id]);
}

function mapearLote(r: {
  id: number;
  formula_id: number;
  data: string;
  peso_previsto_kg: string;
  peso_real_kg: string;
  observacao: string | null;
  criado_em: string;
}): FormulaLote {
  const pesoPrevistoKg = Number(r.peso_previsto_kg);
  const pesoRealKg = Number(r.peso_real_kg);
  const diferencaKg = pesoRealKg - pesoPrevistoKg;
  return {
    id: r.id,
    formulaId: r.formula_id,
    data: dataParaISO(r.data),
    pesoPrevistoKg,
    pesoRealKg,
    observacao: r.observacao,
    diferencaKg,
    diferencaPercentual: pesoPrevistoKg > 0 ? (diferencaKg / pesoPrevistoKg) * 100 : null,
    criadoEm: r.criado_em,
  };
}

export async function listarLotes(formulaId: number): Promise<FormulaLote[]> {
  const { rows } = await pool.query<{
    id: number;
    formula_id: number;
    data: string;
    peso_previsto_kg: string;
    peso_real_kg: string;
    observacao: string | null;
    criado_em: string;
  }>(
    `SELECT id, formula_id, data, peso_previsto_kg, peso_real_kg, observacao, criado_em
     FROM formula_lotes WHERE formula_id = $1 ORDER BY data DESC, id DESC`,
    [formulaId]
  );
  return rows.map(mapearLote);
}

// peso_previsto_kg é sempre o peso_lote_kg ATUAL da fórmula no momento do
// registro (snapshot) — se a fórmula mudar de peso depois, os lotes já
// registrados continuam comparando com o previsto de quando rodaram.
export async function registrarLote(
  formulaId: number,
  data: string,
  pesoRealKg: number,
  observacao: string | null
): Promise<FormulaLote> {
  const { rows: formulaRows } = await pool.query<{ peso_lote_kg: string }>(
    "SELECT peso_lote_kg FROM formulas WHERE id = $1",
    [formulaId]
  );
  if (formulaRows.length === 0) throw new Error("Fórmula não encontrada.");
  const pesoPrevistoKg = Number(formulaRows[0].peso_lote_kg);

  const { rows } = await pool.query<{
    id: number;
    formula_id: number;
    data: string;
    peso_previsto_kg: string;
    peso_real_kg: string;
    observacao: string | null;
    criado_em: string;
  }>(
    `INSERT INTO formula_lotes (formula_id, data, peso_previsto_kg, peso_real_kg, observacao)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, formula_id, data, peso_previsto_kg, peso_real_kg, observacao, criado_em`,
    [formulaId, data, pesoPrevistoKg, pesoRealKg, observacao]
  );
  return mapearLote(rows[0]);
}

// peso_previsto_kg não é editável de propósito — é o snapshot de quando o
// lote foi registrado, editar só o que a pessoa realmente pode ter errado
// ao digitar (data, peso real, observação).
export async function atualizarLote(
  id: number,
  data: string,
  pesoRealKg: number,
  observacao: string | null
): Promise<FormulaLote> {
  const { rows } = await pool.query<{
    id: number;
    formula_id: number;
    data: string;
    peso_previsto_kg: string;
    peso_real_kg: string;
    observacao: string | null;
    criado_em: string;
  }>(
    `UPDATE formula_lotes SET data = $2, peso_real_kg = $3, observacao = $4
     WHERE id = $1
     RETURNING id, formula_id, data, peso_previsto_kg, peso_real_kg, observacao, criado_em`,
    [id, data, pesoRealKg, observacao]
  );
  if (rows.length === 0) throw new Error("Lote não encontrado.");
  return mapearLote(rows[0]);
}

export async function excluirLote(id: number): Promise<void> {
  await pool.query("DELETE FROM formula_lotes WHERE id = $1", [id]);
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
// quantidade pra virar "por unidade" antes de tirar a média. Chamada por
// SKU de EMBALAGEM (cada tamanho de envase costuma ser um anúncio
// separado no ML), não mais por SKU da fórmula inteira.
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
