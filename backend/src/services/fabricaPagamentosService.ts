import { pool } from "../db/pool";
import { dataIso, dataIsoOuNulo } from "./fabricaData";
import { creditoPorCliente } from "./fabricaDevolucoesService";
import { bonificarPagamento } from "./fabricaCreditosService";

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
  // Quem fecha a conta desta loja. Várias vendem no próprio nome e a cobrança
  // vai inteira pra outra — Catedral Ferramentas paga por Lux Collor, Imperium
  // e Fábrica de Tintas. Quando a loja paga por si, o pagante é ela mesma.
  paganteId: number;
  paganteNome: string;
  comprado: number;
  pago: number;
  // credito de devolucao — abate no fechamento igual a um pagamento
  credito: number;
  // saldo em conta: antecipação que a loja pagou adiantado mais a bonificação
  // de 3,5% por quitar em dia. Abate igual a devolução, e vem de outra tabela.
  creditoConta: number;
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
  // identificador do PIX no extrato do banco. Nulo = não veio de conciliação:
  // foi digitado, ou sobrou de uma importação repetida.
  e2e: string | null;
}

// Extrato de uma loja: os pedidos e os pagamentos na mesma linha do tempo,
// com o saldo correndo. É o que se manda pra loja na terça.
export interface LinhaExtrato {
  data: string;
  tipo: "pedido" | "pagamento" | "devolucao";
  referencia: number;
  descricao: string;
  valor: number;
  saldo: number;
}

export async function listarContaCorrente(): Promise<ContaCorrente[]> {
  const creditos = await creditoPorCliente();
  const emConta = await saldosEmConta();
  const { rows } = await pool.query<{
    id: number;
    nome: string;
    tipo: string;
    pagante_id: number;
    pagante_nome: string;
    comprado: string;
    pago: string;
    ultimo_pedido: string | null;
    ultimo_pagamento: string | null;
  }>(
    `SELECT c.id, c.nome, c.tipo,
            COALESCE(c.cliente_pai_id, c.id) AS pagante_id,
            COALESCE(pai.nome, c.nome)       AS pagante_nome,
            COALESCE(ped.total, 0)  AS comprado,
            COALESCE(pag.total, 0)  AS pago,
            ped.ultima              AS ultimo_pedido,
            pag.ultima              AS ultimo_pagamento
     FROM fabrica_clientes c
     LEFT JOIN fabrica_clientes pai ON pai.id = c.cliente_pai_id
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
    // credito de devolucao abate junto com o PIX: pra loja e a mesma coisa,
    // ela pega menos dinheiro do bolso na terca
    const credito = creditos.get(r.id) ?? 0;
    const creditoConta = emConta.get(r.id) ?? 0;
    return {
      clienteId: r.id,
      clienteNome: r.nome,
      clienteTipo: r.tipo,
      paganteId: Number(r.pagante_id),
      paganteNome: r.pagante_nome,
      comprado,
      pago,
      credito,
      creditoConta,
      saldo: comprado - pago - credito - creditoConta,
      ultimoPedido: dataIsoOuNulo(r.ultimo_pedido),
      ultimoPagamento: dataIsoOuNulo(r.ultimo_pagamento),
    };
  });
}

// Saldo de crédito em conta por loja: antecipação + bonificação − o que já
// foi usado. Consulta direta em vez de importar o service de créditos: aquele
// importa este de volta pro cálculo do saldo, e o ciclo trava o build.
async function saldosEmConta(): Promise<Map<number, number>> {
  // NOT provisorio de proposito: a bonificacao provisoria aparece na lista e
  // no total da aba, mas nao abate dívida nenhuma enquanto a loja não quitar.
  //
  // Se abatesse, esquecer de clicar em "excluir crédito" no fim do mês daria
  // o desconto de graça pra sempre — e o botão viraria obrigatório. Assim ele
  // é só faxina da lista, e esquecer nao custa dinheiro.
  const { rows } = await pool.query<{ cliente_id: number; saldo: string }>(
    `SELECT cliente_id, SUM(valor) AS saldo
     FROM fabrica_creditos WHERE NOT provisorio GROUP BY cliente_id`
  );
  return new Map(rows.map((r) => [r.cliente_id, Number(r.saldo)]));
}

// Quanto todas as lojas devem juntas — o "a receber" da fábrica.
export async function totalAReceber(): Promise<number> {
  const contas = await listarContaCorrente();
  // Soma por quem paga, não por quem compra: se a Lux adiantou e a Fábrica de
  // Tintas atrasou, quem manda o PIX é a Catedral Ferramentas e pra ela isso é
  // uma conta só. Somar loja a loja cobraria o atraso e ignoraria o adiantado.
  const porPagante = new Map<number, number>();
  for (const c of contas) {
    porPagante.set(c.paganteId, (porPagante.get(c.paganteId) ?? 0) + c.saldo);
  }
  // grupo negativo é quem pagou adiantado; não abate a dívida dos outros
  return [...porPagante.values()].reduce((s, v) => s + Math.max(0, v), 0);
}

export async function extratoDoCliente(clienteId: number): Promise<LinhaExtrato[]> {
  const [pedidos, pagamentos, devolucoes] = await Promise.all([
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
    pool.query<{ id: number; data: string; credito: string; quantidade: string; condicao: string; nome: string }>(
      `SELECT d.id, d.data, d.credito, d.quantidade, d.condicao, pr.nome
       FROM fabrica_devolucoes d
       JOIN fabrica_produtos pr ON pr.id = d.produto_id
       WHERE d.cliente_id = $1 AND d.credito > 0`,
      [clienteId]
    ),
  ]);

  const linhas: Omit<LinhaExtrato, "saldo">[] = [
    ...pedidos.rows.map((r) => ({
      data: dataIso(r.data),
      tipo: "pedido" as const,
      referencia: r.id,
      descricao: `Pedido ${r.id} — ${r.itens} ${Number(r.itens) === 1 ? "item" : "itens"}`,
      valor: Number(r.total),
    })),
    ...pagamentos.rows.map((r) => ({
      data: dataIso(r.data),
      tipo: "pagamento" as const,
      referencia: r.id,
      descricao: r.observacao ?? "PIX",
      valor: -Number(r.valor),
    })),
    ...devolucoes.rows.map((r) => ({
      data: dataIso(r.data),
      tipo: "devolucao" as const,
      referencia: r.id,
      descricao: `Devolução ${Number(r.quantidade)}× ${r.nome}`,
      valor: -Number(r.credito),
    })),
  ];

  // pedido antes de crédito e pagamento no mesmo dia: senão o saldo aparece
  // negativo no meio do extrato e assusta sem motivo
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

// Quantos pagamentos existem no total, ignorando o teto da listagem.
//
// A tela mostrava 100 e nao dizia que mostrava 100. Somando o que aparecia dava
// R$ 3.046.650,75 onde havia R$ 5.225.316,34 — R$ 2,1 milhoes invisiveis. PIX
// lancado duas vezes ou na loja errada moraria exatamente nessa faixa, e o
// fechamento perdoaria divida que existe sem ninguem ver.
export async function contarPagamentos(): Promise<{ total: number; valor: number }> {
  const { rows } = await pool.query<{ n: string; valor: string }>(
    "SELECT COUNT(*) AS n, COALESCE(SUM(valor), 0) AS valor FROM fabrica_pagamentos"
  );
  return { total: Number(rows[0]?.n ?? 0), valor: Number(rows[0]?.valor ?? 0) };
}

export async function listarPagamentos(limite = 100): Promise<Pagamento[]> {
  const { rows } = await pool.query<{
    id: number;
    cliente_id: number;
    nome: string;
    data: string;
    valor: string;
    observacao: string | null;
    e2e: string | null;
  }>(
    // o e2e amarra o pagamento ao PIX do extrato. Pagamento sem e2e foi digitado
    // a mao ou sobrou de uma importacao repetida — e e ai que mora a duplicata
    // que ninguem enxerga: dois lancamentos iguais, um com PIX e outro sem.
    `SELECT p.id, p.cliente_id, c.nome, p.data, p.valor, p.observacao,
            x.e2e
     FROM fabrica_pagamentos p
     JOIN fabrica_clientes c ON c.id = p.cliente_id
     LEFT JOIN fabrica_pix_recebido x ON x.pagamento_id = p.id
     ORDER BY p.data DESC, p.id DESC LIMIT $1`,
    // teto de 5.000 mesmo pedindo tudo: e conciliacao bancaria, cresce todo mes
    [Math.min(Math.max(limite, 1), 5000)]
  );
  return rows.map((r) => ({
    id: r.id,
    clienteId: r.cliente_id,
    clienteNome: r.nome,
    data: dataIso(r.data),
    valor: Number(r.valor),
    observacao: r.observacao,
    e2e: r.e2e,
  }));
}

export async function registrarPagamento(
  clienteId: number,
  valor: number,
  data: string | null,
  observacao: string | null
): Promise<{
  id: number;
  saldo: number;
  bonificacao: number;
  // pagou parte: o credito saiu, mas so vira dela quitando
  provisorio: boolean;
  // provisorios de pagamentos anteriores que este PIX confirmou
  confirmados: number;
}> {
  // saldo antes do pagamento: é o que diz se este PIX quitou a conta ou só
  // abateu parte dela, e só quitando 100% a loja ganha os 3,5%
  const antes = (await listarContaCorrente()).find((c) => c.clienteId === clienteId);
  const saldoAntes = antes?.saldo ?? 0;

  const cliente = await pool.connect();
  let id: number;
  let bonificacao = 0;
  let provisorio = false;
  let confirmados = 0;
  try {
    await cliente.query("BEGIN");
    const { rows } = await cliente.query(
      `INSERT INTO fabrica_pagamentos (cliente_id, data, valor, observacao)
       VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4)
       RETURNING id, data::text AS data`,
      [clienteId, data, valor, observacao]
    );
    id = Number(rows[0].id);
    const b = await bonificarPagamento(
      cliente,
      clienteId,
      id,
      valor,
      String(rows[0].data),
      saldoAntes,
      saldoAntes - valor
    );
    bonificacao = b.bonus;
    provisorio = b.provisorio;
    confirmados = b.confirmados;
    await cliente.query("COMMIT");
  } catch (err) {
    await cliente.query("ROLLBACK");
    throw err;
  } finally {
    cliente.release();
  }

  // devolve o saldo que sobrou: pagou 90 de 100, ficam 10 pra próxima semana
  const contas = await listarContaCorrente();
  const conta = contas.find((c) => c.clienteId === clienteId);
  return { id, saldo: conta?.saldo ?? 0, bonificacao, provisorio, confirmados };
}

export async function excluirPagamento(id: number): Promise<void> {
  await pool.query("DELETE FROM fabrica_pagamentos WHERE id = $1", [id]);
}

// Quanto cada loja deve, pro alerta de crédito provisório saber quem ainda não
// fechou. Fica aqui e não no service de créditos porque o saldo sai da conta
// corrente, e o caminho contrário criaria import circular.
export async function devendoPorCliente(): Promise<Map<number, number>> {
  const contas = await listarContaCorrente();
  return new Map(contas.map((c) => [c.clienteId, c.saldo]));
}
