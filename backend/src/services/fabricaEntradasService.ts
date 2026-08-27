import { pool } from "../db/pool";
import { dataIsoOuNulo } from "./fabricaData";

// Entrada de mercadoria comprada de fornecedor.
//
// O estoque de produto acabado só somava produção — lote de fábrica enchendo
// baldes. Só que a distribuidora é 93% revenda: o produto é comprado, não
// fabricado. Sem onde registrar a compra, a venda baixava e nada subia, e em
// agosto de 2026 havia 712 produtos com saldo negativo, 27.191 unidades.
//
// O custo fica gravado na linha da entrada, não só no cadastro do produto.
// Preço de fornecedor muda, e depois ninguém lembra por quanto entrou o lote
// de agosto — e é isso que responde se a margem caiu por preço de venda ou
// por custo de compra.

export interface EntradaItem {
  id: number;
  produtoId: number;
  sku: string;
  produtoNome: string;
  quantidade: number;
  custoUnitario: number;
  total: number;
}

export interface Entrada {
  id: number;
  fornecedorId: number | null;
  fornecedorNome: string | null;
  documento: string | null;
  data: string;
  observacao: string | null;
  itens: EntradaItem[];
  quantidade: number;
  total: number;
}

export interface ItemEntrada {
  produtoId: number;
  quantidade: number;
  custoUnitario: number;
}

// Quanto entrou de cada produto. Vai pro cálculo do saldo junto com produção.
export async function entradaPorProduto(): Promise<Map<number, number>> {
  const { rows } = await pool.query<{ produto_id: number; total: string }>(
    `SELECT produto_id, SUM(quantidade) AS total
       FROM fabrica_entrada_itens GROUP BY produto_id`
  );
  return new Map(rows.map((r) => [r.produto_id, Number(r.total)]));
}

export async function listarEntradas(limite = 200): Promise<Entrada[]> {
  const { rows } = await pool.query<{
    id: number;
    fornecedor_id: number | null;
    fornecedor_nome: string | null;
    documento: string | null;
    data: string;
    observacao: string | null;
  }>(
    `SELECT e.id, e.fornecedor_id,
            COALESCE(f.nome, e.fornecedor_nome) AS fornecedor_nome,
            e.documento, e.data::text AS data, e.observacao
       FROM fabrica_entradas e
       LEFT JOIN fabrica_fornecedores f ON f.id = e.fornecedor_id
      ORDER BY e.data DESC, e.id DESC
      LIMIT $1`,
    [limite]
  );
  if (!rows.length) return [];

  const { rows: itens } = await pool.query<{
    id: number;
    entrada_id: number;
    produto_id: number;
    sku: string;
    nome: string;
    quantidade: string;
    custo_unitario: string;
  }>(
    `SELECT i.id, i.entrada_id, i.produto_id, p.sku, p.nome,
            i.quantidade, i.custo_unitario
       FROM fabrica_entrada_itens i
       JOIN fabrica_produtos p ON p.id = i.produto_id
      WHERE i.entrada_id = ANY($1::int[])
      ORDER BY p.sku`,
    [rows.map((r) => r.id)]
  );

  const porEntrada = new Map<number, EntradaItem[]>();
  for (const i of itens) {
    const q = Number(i.quantidade);
    const c = Number(i.custo_unitario);
    const lista = porEntrada.get(i.entrada_id) ?? [];
    lista.push({
      id: i.id,
      produtoId: i.produto_id,
      sku: i.sku,
      produtoNome: i.nome,
      quantidade: q,
      custoUnitario: c,
      total: q * c,
    });
    porEntrada.set(i.entrada_id, lista);
  }

  return rows.map((r) => {
    const lista = porEntrada.get(r.id) ?? [];
    return {
      id: r.id,
      fornecedorId: r.fornecedor_id,
      fornecedorNome: r.fornecedor_nome,
      documento: r.documento,
      data: dataIsoOuNulo(r.data) ?? r.data,
      observacao: r.observacao,
      itens: lista,
      quantidade: lista.reduce((s, i) => s + i.quantidade, 0),
      total: lista.reduce((s, i) => s + i.total, 0),
    };
  });
}

export async function criarEntrada(entrada: {
  fornecedorId: number | null;
  fornecedorNome: string | null;
  documento: string | null;
  data: string | null;
  observacao: string | null;
  itens: ItemEntrada[];
}): Promise<{ id: number; itens: number; total: number }> {
  if (!entrada.itens.length) throw new Error("A entrada não tem nenhum item.");

  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    const { rows } = await cliente.query<{ id: number }>(
      `INSERT INTO fabrica_entradas
         (fornecedor_id, fornecedor_nome, documento, data, observacao)
       VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5)
       RETURNING id`,
      [
        entrada.fornecedorId,
        entrada.fornecedorNome,
        entrada.documento,
        entrada.data,
        entrada.observacao,
      ]
    );
    const id = Number(rows[0].id);
    for (const i of entrada.itens) {
      await cliente.query(
        `INSERT INTO fabrica_entrada_itens
           (entrada_id, produto_id, quantidade, custo_unitario)
         VALUES ($1, $2, $3, $4)`,
        [id, i.produtoId, i.quantidade, i.custoUnitario]
      );
    }
    await cliente.query("COMMIT");
    return {
      id,
      itens: entrada.itens.length,
      total: entrada.itens.reduce((s, i) => s + i.quantidade * i.custoUnitario, 0),
    };
  } catch (err) {
    await cliente.query("ROLLBACK");
    // documento repetido do mesmo fornecedor: é a nota lançada duas vezes
    if (err instanceof Error && /fabrica_entradas_doc/.test(err.message)) {
      throw new Error("Esta nota já foi lançada para este fornecedor.");
    }
    throw err;
  } finally {
    cliente.release();
  }
}

export async function excluirEntrada(id: number): Promise<void> {
  await pool.query("DELETE FROM fabrica_entradas WHERE id = $1", [id]);
}
