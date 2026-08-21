import { pool } from "../db/pool";

// Conta corrente das lojas com a fábrica.
//
// Não existe tabela de "conta a receber". O que a loja deve sai de:
//
//   deve = pedidos não cancelados − pagamentos
//
// Gerar um recebível por pedido criaria dois lugares dizendo a mesma coisa. E
// o pagamento parcial — que aqui é a regra, não a exceção — obrigaria a
// decidir qual pedido foi quitado primeiro, uma decisão inventada que ninguém
// na fábrica toma. Com conta corrente, pagar 90 de 100 simplesmente deixa 10
// rolando pra semana seguinte, que é como já funciona.
//
// Uma forma de pagamento só: PIX no fechamento de terça.

export interface ContaCorrente {
  clienteId: number;
  clienteNome: string;
  clienteTipo: string;
  comprado: number;
  pago: number;
  saldo: number;
  ultimoPedido: string | null;
  ultimoPagamento: string | null;
}

export interface Pagamento {
  id: number;
  clienteId: number;
  clienteNome: string;
  data: string;
  valor: number;
  observacao: string | null;
}

// Extrato de uma loja: os pedidos e os pagamentos na mesma linha do tempo,
// com o saldo correndo. É o que se manda pra loja na terça.
export interface LinhaExtrato {
  data: string;
  tipo: "pedido" | "pagamento";
  referencia: number;
  descricao: string;
  valor: number;
  saldo: number;
}

export async function listarContaCorrente(): Promise<ContaCorrente[]> {
  const { rows } = await pool.query<{
    id: number;
    nome: string;
    tipo: string;
    comprado: string;
    pago: string;
    ultimo_pedido: string | null;
    ultimo_pagamento: string | null;
  }>(
    `SELECT c.id, c.nome, c.tipo,
            COALESCE(ped.total, 0)  AS comprado,
            COALESCE(pag.total, 0)  AS pago,
            ped.ultima              AS ultimo_pedido,
            pag.ultima              AS ultimo_pagamento
     FROM fabrica_clientes c
     LEFT JOIN (
       SELECT p.cliente_id,
              SUM(i.quantidade * i.preco_unitario) AS total,
              MAX(p.data) AS ultima
       FROM fabrica_pedidos p
       JOIN fabrica_pedido_itens i ON i.pedido_id = p.id
       WHERE p.status <> 'CANCELADO'
       GROUP BY p.cliente_id
     ) ped ON ped.cliente_id = c.id
     LEFT JOIN (
       SELECT cliente_id, SUM(valor) AS total, MAX(data) AS ultima
       FROM fabrica_pagamentos GROUP BY cliente_id
     ) pag ON pag.cliente_id = c.id
     ORDER BY c.nome`
  );

  return rows.map((r) => {
    const comprado = Number(r.comprado);
    const pago = Number(r.pago);
    return {
      clienteId: r.id,
      clienteNome: r.nome,
      clienteTipo: r.tipo,
      comprado,
      pago,
      saldo: comprado - pago,
      ultimoPedido: r.ultimo_pedido ? String(r.ultimo_pedido).slice(0, 10) : null,
      ultimoPagamento: r.ultimo_pagamento ? String(r.ultimo_pagamento).slice(0, 10) : null,
    };
  });
}

// Quanto todas as lojas devem juntas — o "a receber" da fábrica.
export async function totalAReceber(): Promise<number> {
  const contas = await listarContaCorrente();
  // saldo negativo é loja que pagou adiantado; não abate a dívida das outras
  return contas.reduce((s, c) => s + Math.max(0, c.saldo), 0);
}

export async function extratoDoCliente(clienteId: number): Promise<LinhaExtrato[]> {
  const [pedidos, pagamentos] = await Promise.all([
    pool.query<{ id: number; data: string; total: string; itens: string }>(
      `SELECT p.id, p.data,
              SUM(i.quantidade * i.preco_unitario) AS total,
              COUNT(i.id) AS itens
       FROM fabrica_pedidos p
       JOIN fabrica_pedido_itens i ON i.pedido_id = p.id
       WHERE p.cliente_id = $1 AND p.status <> 'CANCELADO'
       GROUP BY p.id, p.data`,
      [clienteId]
    ),
    pool.query<{ id: number; data: string; valor: string; observacao: string | null }>(
      "SELECT id, data, valor, observacao FROM fabrica_pagamentos WHERE cliente_id = $1",
      [clienteId]
    ),
  ]);

  const linhas: Omit<LinhaExtrato, "saldo">[] = [
    ...pedidos.rows.map((r) => ({
      data: String(r.data).slice(0, 10),
      tipo: "pedido" as const,
      referencia: r.id,
      descricao: `Pedido ${r.id} — ${r.itens} ${Number(r.itens) === 1 ? "item" : "itens"}`,
      valor: Number(r.total),
    })),
    ...pagamentos.rows.map((r) => ({
      data: String(r.data).slice(0, 10),
      tipo: "pagamento" as const,
      referencia: r.id,
      descricao: r.observacao ?? "PIX",
      valor: -Number(r.valor),
    })),
  ];

  // pedido e pagamento do mesmo dia: o pedido vem primeiro, senão o saldo
  // aparece negativo no meio do extrato e assusta sem motivo
  linhas.sort((a, b) =>
    a.data === b.data
      ? a.tipo === b.tipo
        ? a.referencia - b.referencia
        : a.tipo === "pedido"
          ? -1
          : 1
      : a.data < b.data
        ? -1
        : 1
  );

  let saldo = 0;
  return linhas.map((l) => {
    saldo += l.valor;
    return { ...l, saldo };
  });
}

export async function listarPagamentos(limite = 100): Promise<Pagamento[]> {
  const { rows } = await pool.query<{
    id: number;
    cliente_id: number;
    nome: string;
    data: string;
    valor: string;
    observacao: string | null;
  }>(
    `SELECT p.id, p.cliente_id, c.nome, p.data, p.valor, p.observacao
     FROM fabrica_pagamentos p
     JOIN fabrica_clientes c ON c.id = p.cliente_id
     ORDER BY p.data DESC, p.id DESC LIMIT $1`,
    [limite]
  );
  return rows.map((r) => ({
    id: r.id,
    clienteId: r.cliente_id,
    clienteNome: r.nome,
    data: String(r.data).slice(0, 10),
    valor: Number(r.valor),
    observacao: r.observacao,
  }));
}

export async function registrarPagamento(
  clienteId: number,
  valor: number,
  data: string | null,
  observacao: string | null
): Promise<{ id: number; saldo: number }> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO fabrica_pagamentos (cliente_id, data, valor, observacao)
     VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4) RETURNING id`,
    [clienteId, data, valor, observacao]
  );
  // devolve o saldo que sobrou: pagou 90 de 100, ficam 10 pra próxima semana
  const contas = await listarContaCorrente();
  const conta = contas.find((c) => c.clienteId === clienteId);
  return { id: rows[0].id, saldo: conta?.saldo ?? 0 };
}

export async function excluirPagamento(id: number): Promise<void> {
  await pool.query("DELETE FROM fabrica_pagamentos WHERE id = $1", [id]);
}
