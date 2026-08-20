import { pool } from "../db/pool";

// Estoque de produto acabado da Fábrica Distribuidora.
//
//   produzido  formula_lote_envases — o lote encheu 40 baldes de 18 kg
//   vendido    itens dos pedidos que não foram cancelados
//   ajuste     fabrica_produto_ajustes (inventário, quebra, amostra, devolução)
//
// A ligação lote → produto passa pela embalagem: o produto sabe de qual
// fórmula e de qual envase daquela fórmula ele é. Um lote de Emborrachada
// Areia que encheu 40 baldes de 18 kg produziu 40 unidades do produto
// "Emborrachada Areia 18kg" — e nada dos outros tamanhos.
//
// Produto sem fórmula ou sem embalagem no cadastro não tem como ser produzido
// automaticamente: aparece com produção zero em vez de sumir da tela, pra ficar
// visível que falta o cadastro.

export interface EstoqueProduto {
  produtoId: number;
  sku: string;
  nome: string;
  produzido: number;
  vendido: number;
  ajustes: number;
  saldo: number;
  estoqueMinimo: number;
  abaixoDoMinimo: boolean;
  custoUnitario: number;
  valorEmEstoque: number;
  semCadastroCompleto: boolean;
}

export interface AjusteProduto {
  id: number;
  produtoId: number;
  produtoNome: string;
  data: string;
  quantidade: number;
  motivo: string | null;
}

export async function producaoPorProduto(): Promise<Map<number, number>> {
  const { rows } = await pool.query<{ produto_id: number; total: string }>(
    `SELECT pr.id AS produto_id, SUM(env.quantidade) AS total
     FROM fabrica_produtos pr
     JOIN formula_embalagens fe ON fe.id = pr.embalagem_id
     JOIN formula_lotes l ON l.formula_id = pr.formula_id
     JOIN formula_lote_envases env ON env.lote_id = l.id AND env.nome = fe.nome
     GROUP BY pr.id`
  );
  return new Map(rows.map((r) => [r.produto_id, Number(r.total)]));
}

export async function vendaPorProduto(): Promise<Map<number, number>> {
  const { rows } = await pool.query<{ produto_id: number; total: string }>(
    `SELECT i.produto_id, SUM(i.quantidade) AS total
     FROM fabrica_pedido_itens i
     JOIN fabrica_pedidos p ON p.id = i.pedido_id
     WHERE p.status <> 'CANCELADO'
     GROUP BY i.produto_id`
  );
  return new Map(rows.map((r) => [r.produto_id, Number(r.total)]));
}

// custoUnitario vem de fora (do cálculo de custo do produto, que já existe)
// pra não duplicar aqui a recursão de fórmula e rendimento.
export async function listarEstoqueProdutos(
  custoPor: Map<number, number> = new Map()
): Promise<EstoqueProduto[]> {
  const [produtos, producao, venda, ajustes] = await Promise.all([
    pool.query<{
      id: number;
      sku: string;
      nome: string;
      formula_id: number | null;
      embalagem_id: number | null;
      estoque_minimo: string;
    }>(
      `SELECT id, sku, nome, formula_id, embalagem_id, COALESCE(estoque_minimo, 0) AS estoque_minimo
       FROM fabrica_produtos ORDER BY nome, sku`
    ),
    producaoPorProduto(),
    vendaPorProduto(),
    pool.query<{ produto_id: number; total: string }>(
      "SELECT produto_id, SUM(quantidade) AS total FROM fabrica_produto_ajustes GROUP BY produto_id"
    ),
  ]);

  const ajustePor = new Map(ajustes.rows.map((r) => [r.produto_id, Number(r.total)]));

  return produtos.rows.map((r) => {
    const produzido = producao.get(r.id) ?? 0;
    const vendido = venda.get(r.id) ?? 0;
    const ajuste = ajustePor.get(r.id) ?? 0;
    const saldo = produzido - vendido + ajuste;
    const estoqueMinimo = Number(r.estoque_minimo);
    const custoUnitario = custoPor.get(r.id) ?? 0;
    return {
      produtoId: r.id,
      sku: r.sku,
      nome: r.nome,
      produzido,
      vendido,
      ajustes: ajuste,
      saldo,
      estoqueMinimo,
      // mínimo zero = "não controlo esse", não "está sempre em falta"
      abaixoDoMinimo: estoqueMinimo > 0 && saldo < estoqueMinimo,
      custoUnitario,
      valorEmEstoque: saldo * custoUnitario,
      semCadastroCompleto: r.formula_id === null || r.embalagem_id === null,
    };
  });
}

export async function definirEstoqueMinimoProduto(produtoId: number, minimo: number): Promise<void> {
  await pool.query("UPDATE fabrica_produtos SET estoque_minimo = $2 WHERE id = $1", [produtoId, minimo]);
}

export async function listarAjustesProduto(limite = 50): Promise<AjusteProduto[]> {
  const { rows } = await pool.query<{
    id: number;
    produto_id: number;
    nome: string;
    data: string;
    quantidade: string;
    motivo: string | null;
  }>(
    `SELECT a.id, a.produto_id, pr.nome, a.data, a.quantidade, a.motivo
     FROM fabrica_produto_ajustes a
     JOIN fabrica_produtos pr ON pr.id = a.produto_id
     ORDER BY a.data DESC, a.id DESC LIMIT $1`,
    [limite]
  );
  return rows.map((r) => ({
    id: r.id,
    produtoId: r.produto_id,
    produtoNome: r.nome,
    data: String(r.data).slice(0, 10),
    quantidade: Number(r.quantidade),
    motivo: r.motivo,
  }));
}

export async function registrarAjusteProduto(
  produtoId: number,
  quantidade: number,
  motivo: string | null
): Promise<{ id: number }> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO fabrica_produto_ajustes (produto_id, quantidade, motivo)
     VALUES ($1, $2, $3) RETURNING id`,
    [produtoId, quantidade, motivo]
  );
  return { id: rows[0].id };
}

// Inventário: informa quanto TEM, grava a diferença. Mesma regra do estoque de
// matéria-prima e de embalagem — a diferença é a informação útil.
export async function registrarInventarioProduto(
  produtoId: number,
  contado: number,
  motivo: string | null,
  custoPor?: Map<number, number>
): Promise<{ id: number; diferenca: number }> {
  const estoque = await listarEstoqueProdutos(custoPor);
  const atual = estoque.find((e) => e.produtoId === produtoId);
  if (!atual) throw new Error("Produto não encontrado.");
  const diferenca = contado - atual.saldo;
  const { id } = await registrarAjusteProduto(
    produtoId,
    diferenca,
    motivo ?? `Inventário: contado ${contado}, sistema tinha ${atual.saldo}`
  );
  return { id, diferenca };
}

export async function excluirAjusteProduto(id: number): Promise<void> {
  await pool.query("DELETE FROM fabrica_produto_ajustes WHERE id = $1", [id]);
}
