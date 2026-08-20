import { pool } from "../db/pool";
import { listarEstoqueEmbalagens } from "./fabricaEmbalagemEstoqueService";

// Cadastro de embalagem da Fábrica Distribuidora — o balde, a bombona, o galão.
//
// Por que existe: hoje o custo da embalagem é um número digitado dentro de cada
// fórmula (formula_embalagens.custo_embalagem). O mesmo balde de 18 kg tem o
// preço repetido em 23 fórmulas, e não existia entidade "balde" pra ter saldo,
// mínimo ou alerta de compra. Este cadastro é o lugar único.
//
// A ligação com as fórmulas é opcional (formula_embalagens.fabrica_embalagem_id):
// enquanto uma fórmula não estiver ligada, ela continua usando o número digitado.
// Assim nada quebra e a migração pode ser feita fórmula a fórmula.
export interface FabricaEmbalagem {
  id: number;
  nome: string;
  pesoKg: number;
  custoUnitario: number;
  estoqueMinimo: number;
  ativo: boolean;
  // quando este cadastro divide o balde físico com outro (18/16/15 kg)
  equivaleAId: number | null;
  // derivados — nenhum destes é guardado no banco
  comprado: number;
  consumido: number;
  ajustes: number;
  estoque: number;
  abaixoDoMinimo: boolean;
  formulasLigadas: number;
}

export interface EmbalagemEntrada {
  nome: string;
  pesoKg: number;
  custoUnitario: number;
  estoqueMinimo: number;
  ativo: boolean;
  equivaleAId: number | null;
}

interface Linha {
  id: number;
  nome: string;
  peso_kg: string;
  custo_unitario: string;
  estoque_minimo: string;
  ativo: boolean;
  equivale_a_id: number | null;
  formulas_ligadas: string;
}

interface SaldoDerivado {
  comprado: number;
  consumido: number;
  ajustes: number;
  saldo: number;
  abaixoDoMinimo: boolean;
}

// O cadastro sozinho não sabe o saldo: ele vem de comprado − consumido +
// ajustes, calculado em fabricaEmbalagemEstoqueService. Aqui só junta os dois
// pra tela mostrar cadastro e saldo na mesma linha.
function montar(r: Linha, saldo?: SaldoDerivado): FabricaEmbalagem {
  return {
    id: r.id,
    nome: r.nome,
    pesoKg: Number(r.peso_kg),
    custoUnitario: Number(r.custo_unitario),
    estoqueMinimo: Number(r.estoque_minimo),
    ativo: r.ativo,
    equivaleAId: r.equivale_a_id,
    comprado: saldo?.comprado ?? 0,
    consumido: saldo?.consumido ?? 0,
    ajustes: saldo?.ajustes ?? 0,
    estoque: saldo?.saldo ?? 0,
    abaixoDoMinimo: saldo?.abaixoDoMinimo ?? false,
    formulasLigadas: Number(r.formulas_ligadas),
  };
}

const SELECT_BASE = `
  SELECT e.id, e.nome, e.peso_kg, e.custo_unitario, e.estoque_minimo, e.ativo, e.equivale_a_id,
         (SELECT COUNT(*) FROM formula_embalagens fe WHERE fe.fabrica_embalagem_id = e.id) AS formulas_ligadas
  FROM fabrica_embalagens e
`;

export async function listarEmbalagens(): Promise<FabricaEmbalagem[]> {
  const [cad, estoque] = await Promise.all([
    pool.query<Linha>(`${SELECT_BASE} ORDER BY e.peso_kg DESC, e.nome`),
    listarEstoqueEmbalagens(),
  ]);
  const saldoPor = new Map(estoque.map((e) => [e.embalagemId, e]));
  return cad.rows.map((r) => montar(r, saldoPor.get(r.id)));
}

function valores(e: EmbalagemEntrada) {
  return [e.nome, e.pesoKg, e.custoUnitario, e.estoqueMinimo, e.ativo, e.equivaleAId];
}

export async function criarEmbalagem(e: EmbalagemEntrada): Promise<{ id: number }> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO fabrica_embalagens (nome, peso_kg, custo_unitario, estoque_minimo, ativo, equivale_a_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    valores(e)
  );
  return { id: rows[0].id };
}

export async function atualizarEmbalagem(id: number, e: EmbalagemEntrada): Promise<void> {
  // uma embalagem não pode equivaler a si mesma — o saldo ficaria órfão
  const equivaleAId = e.equivaleAId === id ? null : e.equivaleAId;
  await pool.query(
    `UPDATE fabrica_embalagens
     SET nome = $2, peso_kg = $3, custo_unitario = $4, estoque_minimo = $5, ativo = $6, equivale_a_id = $7
     WHERE id = $1`,
    [id, e.nome, e.pesoKg, e.custoUnitario, e.estoqueMinimo, e.ativo, equivaleAId]
  );
}

export async function excluirEmbalagem(id: number): Promise<void> {
  // as fórmulas ligadas voltam a usar o custo digitado nelas (ON DELETE SET NULL)
  await pool.query("DELETE FROM fabrica_embalagens WHERE id = $1", [id]);
}

// ---------------------------------------------------------------------------
// Ligação com as embalagens das fórmulas
// ---------------------------------------------------------------------------

export interface EmbalagemDeFormula {
  id: number;
  formulaId: number;
  formulaNome: string;
  nome: string;
  pesoKg: number;
  custoDigitado: number;
  fabricaEmbalagemId: number | null;
  fabricaEmbalagemNome: string | null;
}

// Lista as embalagens que existem dentro das fórmulas, com a ligação atual.
// É a tela de "de-para": o operador vê que a fórmula tem um "Balde 18kg" e
// escolhe a qual cadastro ele corresponde.
export async function listarEmbalagensDeFormulas(): Promise<EmbalagemDeFormula[]> {
  const { rows } = await pool.query<{
    id: number;
    formula_id: number;
    formula_nome: string;
    nome: string;
    peso_kg: string;
    custo_embalagem: string;
    fabrica_embalagem_id: number | null;
    fabrica_embalagem_nome: string | null;
  }>(
    `SELECT fe.id, fe.formula_id, f.nome AS formula_nome, fe.nome, fe.peso_kg, fe.custo_embalagem,
            fe.fabrica_embalagem_id, fb.nome AS fabrica_embalagem_nome
     FROM formula_embalagens fe
     JOIN formulas f ON f.id = fe.formula_id
     LEFT JOIN fabrica_embalagens fb ON fb.id = fe.fabrica_embalagem_id
     ORDER BY f.nome, fe.peso_kg DESC`
  );
  return rows.map((r) => ({
    id: r.id,
    formulaId: r.formula_id,
    formulaNome: r.formula_nome,
    nome: r.nome,
    pesoKg: Number(r.peso_kg),
    custoDigitado: Number(r.custo_embalagem),
    fabricaEmbalagemId: r.fabrica_embalagem_id,
    fabricaEmbalagemNome: r.fabrica_embalagem_nome,
  }));
}

export async function ligarEmbalagem(formulaEmbalagemId: number, fabricaEmbalagemId: number | null): Promise<void> {
  await pool.query("UPDATE formula_embalagens SET fabrica_embalagem_id = $2 WHERE id = $1", [
    formulaEmbalagemId,
    fabricaEmbalagemId,
  ]);
}

// Liga automaticamente pelo peso, quando existe exatamente uma embalagem
// cadastrada com aquele peso. Peso ambíguo (duas embalagens de 18 kg) fica
// pro operador decidir — adivinhar aqui é o tipo de "ajuda" que gera custo
// errado sem ninguém perceber.
export async function ligarAutomaticamentePorPeso(): Promise<{ ligadas: number; ambiguas: number }> {
  const { rows } = await pool.query<{ ligadas: string }>(
    `WITH unicas AS (
       SELECT peso_kg, MIN(id) AS id
       FROM fabrica_embalagens
       WHERE ativo
       GROUP BY peso_kg
       HAVING COUNT(*) = 1
     )
     UPDATE formula_embalagens fe
     SET fabrica_embalagem_id = u.id
     FROM unicas u
     WHERE fe.peso_kg = u.peso_kg AND fe.fabrica_embalagem_id IS NULL
     RETURNING fe.id`
  );
  const { rows: amb } = await pool.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM formula_embalagens WHERE fabrica_embalagem_id IS NULL`
  );
  return { ligadas: rows.length, ambiguas: Number(amb[0].n) };
}
