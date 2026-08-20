import { pool } from "../db/pool";
import { listarFormulas } from "./fabricacaoService";

// Produto acabado da Fábrica Distribuidora — o que ela vende para as lojas
// do grupo. Fica separado de `produtos` (que é catálogo de anúncio do Mercado
// Livre, das 20 lojas) de propósito: são operações diferentes.
//
// O custo NÃO é guardado: vem sempre da fórmula ligada ao produto, pelo mesmo
// cálculo recursivo que o Custo de Fabricação já usa. Assim, quando o preço de
// uma matéria-prima muda, o custo de todo produto que a usa acompanha sozinho.
// O único número digitado aqui é o preço de venda.
export interface FabricaProduto {
  id: number;
  sku: string;
  nome: string;
  formulaId: number | null;
  formulaNome: string | null;
  embalagemId: number | null;
  embalagemNome: string | null;
  pesoKg: number;
  custoPorKg: number;
  custoProduto: number;
  custoEmbalagem: number;
  custo: number;
  precoVenda: number;
  margemContribuicao: number;
  markup: number;
  percentualLucro: number;
  ativo: boolean;
}

export interface ProdutoEntrada {
  sku: string;
  nome: string;
  formulaId: number | null;
  embalagemId: number | null;
  precoVenda: number;
  ativo: boolean;
}

interface LinhaBruta {
  id: number;
  sku: string;
  nome: string;
  formula_id: number | null;
  formula_nome: string | null;
  embalagem_id: number | null;
  embalagem_nome: string | null;
  peso_kg: string | null;
  custo_embalagem: string | null;
  preco_venda: string;
  ativo: boolean;
}

// margem/markup/%lucro sempre derivados — nunca guardados, pra não existir a
// chance de ficarem defasados em relação ao custo.
function calcularIndicadores(custo: number, precoVenda: number) {
  const margemContribuicao = precoVenda - custo;
  return {
    margemContribuicao,
    markup: custo > 0 ? margemContribuicao / custo : 0,
    percentualLucro: precoVenda > 0 ? margemContribuicao / precoVenda : 0,
  };
}

function montar(r: LinhaBruta, custoPorKgPorFormula: Map<number, number>): FabricaProduto {
  const custoPorKg = r.formula_id !== null ? custoPorKgPorFormula.get(r.formula_id) ?? 0 : 0;
  const pesoKg = r.peso_kg !== null ? Number(r.peso_kg) : 0;
  const custoEmbalagem = r.custo_embalagem !== null ? Number(r.custo_embalagem) : 0;
  const custoProduto = custoPorKg * pesoKg;
  const custo = custoProduto + custoEmbalagem;
  const precoVenda = Number(r.preco_venda);
  return {
    id: r.id,
    sku: r.sku,
    nome: r.nome,
    formulaId: r.formula_id,
    formulaNome: r.formula_nome,
    embalagemId: r.embalagem_id,
    embalagemNome: r.embalagem_nome,
    pesoKg,
    custoPorKg,
    custoProduto,
    custoEmbalagem,
    custo,
    precoVenda,
    ativo: r.ativo,
    ...calcularIndicadores(custo, precoVenda),
  };
}

const SELECT_BASE = `
  SELECT p.id, p.sku, p.nome, p.formula_id, f.nome AS formula_nome,
         p.embalagem_id, e.nome AS embalagem_nome, e.peso_kg, e.custo_embalagem,
         p.preco_venda, p.ativo
  FROM fabrica_produtos p
  LEFT JOIN formulas f ON f.id = p.formula_id
  LEFT JOIN formula_embalagens e ON e.id = p.embalagem_id
`;

export async function listarProdutos(): Promise<FabricaProduto[]> {
  // uma chamada só pra ter o custo/kg de todas as fórmulas — evita N+1
  const formulas = await listarFormulas();
  const custoPorKg = new Map(formulas.map((f) => [f.id, f.custoPorKg]));
  const { rows } = await pool.query<LinhaBruta>(`${SELECT_BASE} ORDER BY p.nome`);
  return rows.map((r) => montar(r, custoPorKg));
}

export async function obterProduto(id: number): Promise<FabricaProduto | null> {
  const formulas = await listarFormulas();
  const custoPorKg = new Map(formulas.map((f) => [f.id, f.custoPorKg]));
  const { rows } = await pool.query<LinhaBruta>(`${SELECT_BASE} WHERE p.id = $1`, [id]);
  return rows[0] ? montar(rows[0], custoPorKg) : null;
}

// A embalagem tem de pertencer à fórmula escolhida — senão o custo sairia de
// uma combinação que não existe na produção.
async function validarEmbalagem(formulaId: number | null, embalagemId: number | null): Promise<void> {
  if (embalagemId === null) return;
  if (formulaId === null) throw new Error("Escolha a fórmula antes da embalagem.");
  const { rows } = await pool.query<{ formula_id: number }>(
    "SELECT formula_id FROM formula_embalagens WHERE id = $1",
    [embalagemId]
  );
  if (!rows[0]) throw new Error("Embalagem não encontrada.");
  if (rows[0].formula_id !== formulaId) throw new Error("Essa embalagem é de outra fórmula.");
}

export async function criarProduto(entrada: ProdutoEntrada): Promise<{ id: number }> {
  await validarEmbalagem(entrada.formulaId, entrada.embalagemId);
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO fabrica_produtos (sku, nome, formula_id, embalagem_id, preco_venda, ativo)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [entrada.sku, entrada.nome, entrada.formulaId, entrada.embalagemId, entrada.precoVenda, entrada.ativo]
  );
  return { id: rows[0].id };
}

export async function atualizarProduto(id: number, entrada: ProdutoEntrada): Promise<void> {
  await validarEmbalagem(entrada.formulaId, entrada.embalagemId);
  await pool.query(
    `UPDATE fabrica_produtos
     SET sku = $2, nome = $3, formula_id = $4, embalagem_id = $5, preco_venda = $6, ativo = $7
     WHERE id = $1`,
    [id, entrada.sku, entrada.nome, entrada.formulaId, entrada.embalagemId, entrada.precoVenda, entrada.ativo]
  );
}

export async function excluirProduto(id: number): Promise<void> {
  await pool.query("DELETE FROM fabrica_produtos WHERE id = $1", [id]);
}
