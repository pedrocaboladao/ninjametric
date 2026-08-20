import { pool } from "../db/pool";

// Cadastro de embalagem da Fábrica Distribuidora — o balde, a bombona, o galão.
//
// Por que existe: hoje o custo da embalagem é um número digitado dentro de cada
// fórmula (formula_embalagens.custo_embalagem). O mesmo balde de 18 kg tem o
// preço repetido em 23 fórmulas, e não existe entidade "balde" pra ter saldo,
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
  estoque: number;
  estoqueMinimo: number;
  ativo: boolean;
  // derivados
  abaixoDoMinimo: boolean;
  formulasLigadas: number;
}

export interface EmbalagemEntrada {
  nome: string;
  pesoKg: number;
  custoUnitario: number;
  estoque: number;
  estoqueMinimo: number;
  ativo: boolean;
}

interface Linha {
  id: number;
  nome: string;
  peso_kg: string;
  custo_unitario: string;
  estoque: string;
  estoque_minimo: string;
  ativo: boolean;
  formulas_ligadas: string;
}

function montar(r: Linha): FabricaEmbalagem {
  const estoque = Number(r.estoque);
  const estoqueMinimo = Number(r.estoque_minimo);
  return {
    id: r.id,
    nome: r.nome,
    pesoKg: Number(r.peso_kg),
    custoUnitario: Number(r.custo_unitario),
    estoque,
    estoqueMinimo,
    ativo: r.ativo,
    // só alerta quando existe mínimo definido — mínimo zero significa
    // "não controlo essa", não "está sempre em falta"
    abaixoDoMinimo: estoqueMinimo > 0 && estoque < estoqueMinimo,
    formulasLigadas: Number(r.formulas_ligadas),
  };
}

const SELECT_BASE = `
  SELECT e.id, e.nome, e.peso_kg, e.custo_unitario, e.estoque, e.estoque_minimo, e.ativo,
         (SELECT COUNT(*) FROM formula_embalagens fe WHERE fe.fabrica_embalagem_id = e.id) AS formulas_ligadas
  FROM fabrica_embalagens e
`;

export async function listarEmbalagens(): Promise<FabricaEmbalagem[]> {
  const { rows } = await pool.query<Linha>(`${SELECT_BASE} ORDER BY e.peso_kg DESC, e.nome`);
  return rows.map(montar);
}

function valores(e: EmbalagemEntrada) {
  return [e.nome, e.pesoKg, e.custoUnitario, e.estoque, e.estoqueMinimo, e.ativo];
}

export async function criarEmbalagem(e: EmbalagemEntrada): Promise<{ id: number }> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO fabrica_embalagens (nome, peso_kg, custo_unitario, estoque, estoque_minimo, ativo)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    valores(e)
  );
  return { id: rows[0].id };
}

export async function atualizarEmbalagem(id: number, e: EmbalagemEntrada): Promise<void> {
  await pool.query(
    `UPDATE fabrica_embalagens
     SET nome = $2, peso_kg = $3, custo_unitario = $4, estoque = $5, estoque_minimo = $6, ativo = $7
     WHERE id = $1`,
    [id, ...valores(e)]
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
