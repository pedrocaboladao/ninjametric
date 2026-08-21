import { pool } from "../db/pool";

// Estoque de matéria-prima da Fábrica Distribuidora.
//
// O saldo não é guardado — é sempre recalculado de três fontes:
//
//   comprado   materia_prima_compras (já existia, do Custo de Fabricação)
//   consumido  explodindo a receita de cada lote de produção até a MP crua
//   ajuste     fabrica_estoque_ajustes (inventário, perda, correção)
//
// Guardar saldo dá divergência silenciosa: qualquer lote lançado com atraso,
// ou compra corrigida depois, deixaria o número parado. Recalcular custa uma
// consulta e nunca mente.

export interface EstoqueMateriaPrima {
  materiaPrimaId: number;
  nome: string;
  custoPorKg: number;
  comprado: number;
  consumido: number;
  ajustes: number;
  saldo: number;
  estoqueMinimo: number;
  abaixoDoMinimo: boolean;
  valorEmEstoque: number;
  // agua sai da torneira: custa, mas nao se compra nem se conta
  controlaEstoque: boolean;
}

export interface Ajuste {
  id: number;
  materiaPrimaId: number;
  materiaPrimaNome: string;
  data: string;
  quantidadeKg: number;
  motivo: string | null;
  criadoEm: string;
}

// --- explosão da receita -----------------------------------------------------

interface ItemBruto {
  formulaId: number;
  materiaPrimaId: number | null;
  subFormulaId: number | null;
  percentual: number;
}

// Quanto de cada matéria-prima entra em 1 kg da fórmula, já explodindo as
// sub-fórmulas. É a mesma recursão do custo, mas acumulando fração por insumo
// em vez de somar dinheiro: a cor não consome "Base A", consome a resina, a
// malha e o titânio que estão dentro dela.
//
// emCalculo trava ciclo: se por algum motivo uma fórmula referenciar a si
// mesma, para em vez de estourar a pilha.
function explodir(
  formulaId: number,
  itensPorFormula: Map<number, ItemBruto[]>,
  cache: Map<number, Map<number, number>>,
  emCalculo = new Set<number>()
): Map<number, number> {
  const pronto = cache.get(formulaId);
  if (pronto) return pronto;
  if (emCalculo.has(formulaId)) return new Map();

  emCalculo.add(formulaId);
  const fracoes = new Map<number, number>();
  for (const item of itensPorFormula.get(formulaId) ?? []) {
    const fracao = item.percentual / 100;
    if (item.materiaPrimaId !== null) {
      fracoes.set(item.materiaPrimaId, (fracoes.get(item.materiaPrimaId) ?? 0) + fracao);
    } else if (item.subFormulaId !== null) {
      for (const [mpId, f] of explodir(item.subFormulaId, itensPorFormula, cache, emCalculo)) {
        fracoes.set(mpId, (fracoes.get(mpId) ?? 0) + fracao * f);
      }
    }
  }
  emCalculo.delete(formulaId);
  cache.set(formulaId, fracoes);
  return fracoes;
}

async function itensPorFormula(): Promise<Map<number, ItemBruto[]>> {
  const { rows } = await pool.query<{
    formula_id: number;
    materia_prima_id: number | null;
    sub_formula_id: number | null;
    percentual: string;
  }>("SELECT formula_id, materia_prima_id, sub_formula_id, percentual FROM formula_itens");
  const mapa = new Map<number, ItemBruto[]>();
  for (const r of rows) {
    const lista = mapa.get(r.formula_id) ?? [];
    lista.push({
      formulaId: r.formula_id,
      materiaPrimaId: r.materia_prima_id,
      subFormulaId: r.sub_formula_id,
      percentual: Number(r.percentual),
    });
    mapa.set(r.formula_id, lista);
  }
  return mapa;
}

// Consumo acumulado de cada matéria-prima, somando todos os lotes já lançados.
//
// Usa peso PREVISTO, não o real: a matéria-prima é pesada pela receita antes
// de ir pro tanque. O peso real é quanto saiu depois (mais ou menos água), e
// não muda o que foi pesado na entrada.
export async function consumoPorMateriaPrima(): Promise<Map<number, number>> {
  const [itens, lotes] = await Promise.all([
    itensPorFormula(),
    pool.query<{ formula_id: number; previsto: string }>(
      "SELECT formula_id, SUM(peso_previsto_kg) AS previsto FROM formula_lotes GROUP BY formula_id"
    ),
  ]);
  const cache = new Map<number, Map<number, number>>();
  const consumo = new Map<number, number>();
  for (const l of lotes.rows) {
    const peso = Number(l.previsto);
    for (const [mpId, fracao] of explodir(l.formula_id, itens, cache)) {
      consumo.set(mpId, (consumo.get(mpId) ?? 0) + fracao * peso);
    }
  }
  return consumo;
}

// --- saldo -------------------------------------------------------------------

export async function listarEstoque(): Promise<EstoqueMateriaPrima[]> {
  const [mps, compras, ajustes, consumo] = await Promise.all([
    pool.query<{
      id: number;
      nome: string;
      custo_por_kg: string;
      estoque_minimo: string;
      controla_estoque: boolean;
    }>(
      `SELECT id, nome, custo_por_kg, COALESCE(estoque_minimo, 0) AS estoque_minimo,
              COALESCE(controla_estoque, TRUE) AS controla_estoque
       FROM materias_primas ORDER BY nome`
    ),
    pool.query<{ materia_prima_id: number; total: string }>(
      "SELECT materia_prima_id, SUM(quantidade_kg) AS total FROM materia_prima_compras GROUP BY materia_prima_id"
    ),
    pool.query<{ materia_prima_id: number; total: string }>(
      "SELECT materia_prima_id, SUM(quantidade_kg) AS total FROM fabrica_estoque_ajustes GROUP BY materia_prima_id"
    ),
    consumoPorMateriaPrima(),
  ]);

  const compradoPor = new Map(compras.rows.map((r) => [r.materia_prima_id, Number(r.total)]));
  const ajustePor = new Map(ajustes.rows.map((r) => [r.materia_prima_id, Number(r.total)]));

  return mps.rows.map((r) => {
    const comprado = compradoPor.get(r.id) ?? 0;
    const consumido = consumo.get(r.id) ?? 0;
    const ajuste = ajustePor.get(r.id) ?? 0;
    const saldo = comprado - consumido + ajuste;
    const estoqueMinimo = Number(r.estoque_minimo);
    const custoPorKg = Number(r.custo_por_kg);
    const controlaEstoque = r.controla_estoque !== false;
    return {
      materiaPrimaId: r.id,
      nome: r.nome,
      custoPorKg,
      comprado,
      consumido,
      ajustes: ajuste,
      saldo,
      estoqueMinimo,
      // mínimo zero significa "não controlo essa", não "está sempre em falta"
      abaixoDoMinimo: controlaEstoque && estoqueMinimo > 0 && saldo < estoqueMinimo,
      // insumo não controlado não tem saldo confiável, então não tem valor
      valorEmEstoque: controlaEstoque ? saldo * custoPorKg : 0,
      controlaEstoque,
    };
  });
}

export async function definirEstoqueMinimo(materiaPrimaId: number, minimo: number): Promise<void> {
  await pool.query("UPDATE materias_primas SET estoque_minimo = $2 WHERE id = $1", [
    materiaPrimaId,
    minimo,
  ]);
}

export async function definirControlaEstoque(
  materiaPrimaId: number,
  controla: boolean
): Promise<void> {
  await pool.query("UPDATE materias_primas SET controla_estoque = $2 WHERE id = $1", [
    materiaPrimaId,
    controla,
  ]);
}

// --- ajustes -----------------------------------------------------------------

export async function listarAjustes(limite = 50): Promise<Ajuste[]> {
  const { rows } = await pool.query<{
    id: number;
    materia_prima_id: number;
    nome: string;
    data: string;
    quantidade_kg: string;
    motivo: string | null;
    criado_em: string;
  }>(
    `SELECT a.id, a.materia_prima_id, mp.nome, a.data, a.quantidade_kg, a.motivo, a.criado_em
     FROM fabrica_estoque_ajustes a
     JOIN materias_primas mp ON mp.id = a.materia_prima_id
     ORDER BY a.data DESC, a.id DESC
     LIMIT $1`,
    [limite]
  );
  return rows.map((r) => ({
    id: r.id,
    materiaPrimaId: r.materia_prima_id,
    materiaPrimaNome: r.nome,
    data: String(r.data).slice(0, 10),
    quantidadeKg: Number(r.quantidade_kg),
    motivo: r.motivo,
    criadoEm: r.criado_em,
  }));
}

export async function registrarAjuste(
  materiaPrimaId: number,
  quantidadeKg: number,
  motivo: string | null
): Promise<{ id: number }> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO fabrica_estoque_ajustes (materia_prima_id, quantidade_kg, motivo)
     VALUES ($1, $2, $3) RETURNING id`,
    [materiaPrimaId, quantidadeKg, motivo]
  );
  return { id: rows[0].id };
}

// Inventário: o operador conta e informa quanto TEM. O sistema calcula a
// diferença e grava como ajuste — assim o histórico mostra o quanto divergiu,
// não só o número novo.
export async function registrarInventario(
  materiaPrimaId: number,
  contadoKg: number,
  motivo: string | null
): Promise<{ id: number; diferenca: number }> {
  const estoque = await listarEstoque();
  const atual = estoque.find((e) => e.materiaPrimaId === materiaPrimaId);
  if (!atual) throw new Error("Matéria-prima não encontrada.");
  const diferenca = contadoKg - atual.saldo;
  const { id } = await registrarAjuste(
    materiaPrimaId,
    diferenca,
    motivo ?? `Inventário: contado ${contadoKg} kg, sistema tinha ${atual.saldo.toFixed(3)} kg`
  );
  return { id, diferenca };
}

export async function excluirAjuste(id: number): Promise<void> {
  await pool.query("DELETE FROM fabrica_estoque_ajustes WHERE id = $1", [id]);
}

// --- capacidade de produção --------------------------------------------------

export interface CapacidadeFormula {
  formulaId: number;
  formulaNome: string;
  // null quando a fórmula não tem nenhum insumo controlado limitando: não é
  // "dá zero", é "não dá pra dizer"
  maximoKg: number | null;
  gargaloNome: string | null;
  gargaloSaldo: number;
  gargaloFracao: number;
}

// Quanto dá pra fabricar de cada fórmula com o estoque de hoje. O insumo que
// acaba primeiro manda — não o que está mais baixo em quilos, mas o que trava
// a produção antes, considerando quanto a receita pede de cada um.
export async function capacidadeDeProducao(): Promise<CapacidadeFormula[]> {
  const [itens, formulas, estoque] = await Promise.all([
    itensPorFormula(),
    pool.query<{ id: number; nome: string }>("SELECT id, nome FROM formulas ORDER BY nome"),
    listarEstoque(),
  ]);
  const saldoPor = new Map(estoque.map((e) => [e.materiaPrimaId, e]));
  const cache = new Map<number, Map<number, number>>();

  return formulas.rows.map((f) => {
    const fracoes = explodir(f.id, itens, cache);
    let maximoKg = Infinity;
    let gargalo: { nome: string; saldo: number; fracao: number } | null = null;
    for (const [mpId, fracao] of fracoes) {
      if (fracao <= 0) continue;
      const mp = saldoPor.get(mpId);
      // água não trava produção — sem isso ela seria o gargalo de tudo, porque
      // é 30 a 39% de cada receita e nunca tem saldo
      if (mp && !mp.controlaEstoque) continue;
      const saldo = mp?.saldo ?? 0;
      const possivel = saldo / fracao;
      if (possivel < maximoKg) {
        maximoKg = possivel;
        gargalo = { nome: mp?.nome ?? `#${mpId}`, saldo, fracao };
      }
    }
    return {
      formulaId: f.id,
      formulaNome: f.nome,
      maximoKg: Number.isFinite(maximoKg) ? Math.max(0, maximoKg) : null,
      gargaloNome: gargalo?.nome ?? null,
      gargaloSaldo: gargalo?.saldo ?? 0,
      gargaloFracao: gargalo?.fracao ?? 0,
    };
  });
}
