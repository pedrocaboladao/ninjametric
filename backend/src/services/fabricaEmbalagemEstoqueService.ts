import { pool } from "../db/pool";
import { dataIso } from "./fabricaData";

// Estoque de embalagem da Fábrica Distribuidora.
//
//   comprado   fabrica_embalagem_compras
//   consumido  formula_lote_envases — cada envase de cada lote é um balde a menos
//   ajuste     fabrica_embalagem_ajustes (inventário, quebra, correção)
//
// Mesma regra do estoque de matéria-prima: saldo não é guardado, é recalculado.
// A embalagem tem um agravante próprio — o balde de 18, 16 e 15 kg é o MESMO
// balde físico, muda só quanto se põe dentro. Por isso o saldo é somado no
// "balde raiz" (equivale_a_id), senão o sistema acharia que tem três estoques
// separados e nunca avisaria pra comprar.

export interface EstoqueEmbalagem {
  embalagemId: number;
  nome: string;
  pesoKg: number;
  custoUnitario: number;
  // quando esta embalagem divide o físico com outra, aponta pra ela
  raizId: number;
  raizNome: string;
  compartilha: boolean;
  comprado: number;
  consumido: number;
  ajustes: number;
  saldo: number;
  estoqueMinimo: number;
  abaixoDoMinimo: boolean;
  valorEmEstoque: number;
}

export interface MovimentoEmbalagem {
  id: number;
  embalagemId: number;
  embalagemNome: string;
  data: string;
  quantidade: number;
  custoUnitario: number | null;
  texto: string | null;
}

interface Cadastro {
  id: number;
  nome: string;
  peso_kg: string;
  custo_unitario: string;
  estoque_minimo: string;
  equivale_a_id: number | null;
}

// Segue a corrente de equivalência até o balde que não aponta pra ninguém.
// Trava em ciclo (A→B→A) pra não derrubar a tela por causa de um cadastro
// preenchido errado.
function raizDe(id: number, porId: Map<number, Cadastro>): number {
  const visitados = new Set<number>();
  let atual = id;
  for (;;) {
    const c = porId.get(atual);
    if (!c?.equivale_a_id || visitados.has(atual)) return atual;
    visitados.add(atual);
    atual = c.equivale_a_id;
  }
}

// Quantos baldes cada cadastro já consumiu, somando todos os lotes.
//
// O lote guarda o envase como texto ("Balde 18kg") + peso, copiado da fórmula.
// Pra saber a qual cadastro isso corresponde, passa pela ligação que a tela de
// Embalagens já faz (formula_embalagens.fabrica_embalagem_id). Se a fórmula
// ainda não foi ligada, cai no peso: um cadastro com peso idêntico resolve
// sozinho. Peso repetido em dois cadastros não chuta — fica sem consumo, e a
// tela mostra que aquela ligação está faltando.
export async function consumoPorEmbalagem(): Promise<Map<number, number>> {
  const [envases, vinculos, cadastros] = await Promise.all([
    pool.query<{ formula_id: number; nome: string; peso_kg: string; total: string }>(
      `SELECT l.formula_id, env.nome, env.peso_kg, SUM(env.quantidade) AS total
       FROM formula_lote_envases env
       JOIN formula_lotes l ON l.id = env.lote_id
       GROUP BY l.formula_id, env.nome, env.peso_kg`
    ),
    pool.query<{ formula_id: number; nome: string; fabrica_embalagem_id: number }>(
      `SELECT formula_id, nome, fabrica_embalagem_id
       FROM formula_embalagens WHERE fabrica_embalagem_id IS NOT NULL`
    ),
    pool.query<{ id: number; peso_kg: string }>("SELECT id, peso_kg FROM fabrica_embalagens"),
  ]);

  const ligado = new Map(
    vinculos.rows.map((v) => [`${v.formula_id}|${v.nome}`, v.fabrica_embalagem_id])
  );

  // peso → cadastro, mas só quando aquele peso identifica um cadastro só
  const porPeso = new Map<string, number | null>();
  for (const c of cadastros.rows) {
    const chave = Number(c.peso_kg).toFixed(3);
    porPeso.set(chave, porPeso.has(chave) ? null : c.id);
  }

  const consumo = new Map<number, number>();
  for (const e of envases.rows) {
    const id =
      ligado.get(`${e.formula_id}|${e.nome}`) ?? porPeso.get(Number(e.peso_kg).toFixed(3)) ?? null;
    if (id === null) continue;
    consumo.set(id, (consumo.get(id) ?? 0) + Number(e.total));
  }
  return consumo;
}

export async function listarEstoqueEmbalagens(): Promise<EstoqueEmbalagem[]> {
  const [cads, compras, ajustes, consumo] = await Promise.all([
    pool.query<Cadastro>(
      `SELECT id, nome, peso_kg, custo_unitario, COALESCE(estoque_minimo, 0) AS estoque_minimo, equivale_a_id
       FROM fabrica_embalagens ORDER BY peso_kg DESC, nome`
    ),
    pool.query<{ embalagem_id: number; total: string }>(
      "SELECT embalagem_id, SUM(quantidade) AS total FROM fabrica_embalagem_compras GROUP BY embalagem_id"
    ),
    pool.query<{ embalagem_id: number; total: string }>(
      "SELECT embalagem_id, SUM(quantidade) AS total FROM fabrica_embalagem_ajustes GROUP BY embalagem_id"
    ),
    consumoPorEmbalagem(),
  ]);

  const porId = new Map(cads.rows.map((c) => [c.id, c]));
  const compradoPor = new Map(compras.rows.map((r) => [r.embalagem_id, Number(r.total)]));
  const ajustePor = new Map(ajustes.rows.map((r) => [r.embalagem_id, Number(r.total)]));

  // tudo que pertence ao mesmo balde físico vira um saldo só
  const somaNaRaiz = new Map<number, { comprado: number; consumido: number; ajustes: number }>();
  for (const c of cads.rows) {
    const raiz = raizDe(c.id, porId);
    const acc = somaNaRaiz.get(raiz) ?? { comprado: 0, consumido: 0, ajustes: 0 };
    acc.comprado += compradoPor.get(c.id) ?? 0;
    acc.consumido += consumo.get(c.id) ?? 0;
    acc.ajustes += ajustePor.get(c.id) ?? 0;
    somaNaRaiz.set(raiz, acc);
  }

  return cads.rows.map((c) => {
    const raizId = raizDe(c.id, porId);
    const raiz = porId.get(raizId);
    const t = somaNaRaiz.get(raizId) ?? { comprado: 0, consumido: 0, ajustes: 0 };
    const saldo = t.comprado - t.consumido + t.ajustes;
    // o mínimo que manda é o do balde raiz — é ele que se compra
    const estoqueMinimo = Number(raiz?.estoque_minimo ?? c.estoque_minimo);
    const custoUnitario = Number(c.custo_unitario);
    return {
      embalagemId: c.id,
      nome: c.nome,
      pesoKg: Number(c.peso_kg),
      custoUnitario,
      raizId,
      raizNome: raiz?.nome ?? c.nome,
      compartilha: raizId !== c.id,
      comprado: t.comprado,
      consumido: t.consumido,
      ajustes: t.ajustes,
      saldo,
      estoqueMinimo,
      // mínimo zero = "não controlo essa", não "está sempre em falta"
      abaixoDoMinimo: estoqueMinimo > 0 && saldo < estoqueMinimo,
      valorEmEstoque: saldo * custoUnitario,
    };
  });
}

// --- compras -----------------------------------------------------------------

export async function listarComprasEmbalagem(limite = 50): Promise<MovimentoEmbalagem[]> {
  const { rows } = await pool.query<{
    id: number;
    embalagem_id: number;
    nome: string;
    data: string;
    quantidade: number;
    custo_unitario: string;
    observacao: string | null;
  }>(
    `SELECT c.id, c.embalagem_id, e.nome, c.data, c.quantidade, c.custo_unitario, c.observacao
     FROM fabrica_embalagem_compras c
     JOIN fabrica_embalagens e ON e.id = c.embalagem_id
     ORDER BY c.data DESC, c.id DESC LIMIT $1`,
    [limite]
  );
  return rows.map((r) => ({
    id: r.id,
    embalagemId: r.embalagem_id,
    embalagemNome: r.nome,
    data: dataIso(r.data),
    quantidade: r.quantidade,
    custoUnitario: Number(r.custo_unitario),
    texto: r.observacao,
  }));
}

// Comprar também atualiza o custo unitário do cadastro: o preço que vale pro
// custo do produto é o da última compra, não o que foi digitado uma vez.
export async function registrarCompraEmbalagem(
  embalagemId: number,
  quantidade: number,
  custoUnitario: number,
  data: string | null,
  observacao: string | null
): Promise<{ id: number }> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO fabrica_embalagem_compras (embalagem_id, data, quantidade, custo_unitario, observacao)
     VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5) RETURNING id`,
    [embalagemId, data, quantidade, custoUnitario, observacao]
  );
  if (custoUnitario > 0) {
    await pool.query("UPDATE fabrica_embalagens SET custo_unitario = $2 WHERE id = $1", [
      embalagemId,
      custoUnitario,
    ]);
  }
  return { id: rows[0].id };
}

export async function excluirCompraEmbalagem(id: number): Promise<void> {
  await pool.query("DELETE FROM fabrica_embalagem_compras WHERE id = $1", [id]);
}

// --- ajustes -----------------------------------------------------------------

export async function listarAjustesEmbalagem(limite = 50): Promise<MovimentoEmbalagem[]> {
  const { rows } = await pool.query<{
    id: number;
    embalagem_id: number;
    nome: string;
    data: string;
    quantidade: number;
    motivo: string | null;
  }>(
    `SELECT a.id, a.embalagem_id, e.nome, a.data, a.quantidade, a.motivo
     FROM fabrica_embalagem_ajustes a
     JOIN fabrica_embalagens e ON e.id = a.embalagem_id
     ORDER BY a.data DESC, a.id DESC LIMIT $1`,
    [limite]
  );
  return rows.map((r) => ({
    id: r.id,
    embalagemId: r.embalagem_id,
    embalagemNome: r.nome,
    data: dataIso(r.data),
    quantidade: r.quantidade,
    custoUnitario: null,
    texto: r.motivo,
  }));
}

export async function registrarAjusteEmbalagem(
  embalagemId: number,
  quantidade: number,
  motivo: string | null
): Promise<{ id: number }> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO fabrica_embalagem_ajustes (embalagem_id, quantidade, motivo)
     VALUES ($1, $2, $3) RETURNING id`,
    [embalagemId, quantidade, motivo]
  );
  return { id: rows[0].id };
}

// Inventário: o operador conta e diz quanto TEM. Grava a diferença, não o
// número novo — o histórico precisa mostrar o quanto divergiu.
export async function registrarInventarioEmbalagem(
  embalagemId: number,
  contado: number,
  motivo: string | null
): Promise<{ id: number; diferenca: number }> {
  const estoque = await listarEstoqueEmbalagens();
  const atual = estoque.find((e) => e.embalagemId === embalagemId);
  if (!atual) throw new Error("Embalagem não encontrada.");
  const diferenca = Math.round(contado - atual.saldo);
  // lança no balde raiz: contar o de 16 kg é contar o mesmo balde do de 18
  const { id } = await registrarAjusteEmbalagem(
    atual.raizId,
    diferenca,
    motivo ?? `Inventário: contado ${contado}, sistema tinha ${atual.saldo}`
  );
  return { id, diferenca };
}

export async function excluirAjusteEmbalagem(id: number): Promise<void> {
  await pool.query("DELETE FROM fabrica_embalagem_ajustes WHERE id = $1", [id]);
}
