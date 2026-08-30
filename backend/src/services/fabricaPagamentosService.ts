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
  ativo: boolean;
  // entra no ciclo semanal de cobranca. Quem compra esporadico e paga na hora
  // fica fora — e outra pergunta que "esta ativo"
  naCobranca: boolean;
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
    ativo: boolean;
    na_cobranca: boolean;
    pagante_id: number;
    pagante_nome: string;
    comprado: string;
    pago: string;
    ultimo_pedido: string | null;
    ultimo_pagamento: string | null;
  }>(
    `SELECT c.id, c.nome, c.tipo, c.ativo, c.na_cobranca,
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
      ativo: r.ativo,
      naCobranca: r.na_cobranca,
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

// ---------------------------------------------------------------------------
// Fechamento semanal de cobrança.
//
// Terça a segunda, recebendo na terça — mas não travado no calendário. Feriado,
// falta ou atraso empurram o dia, e o ciclo acompanha: o período vem sugerido e
// quem fecha decide.
//
// O `previsto` é o saldo que a loja devia no dia do fechamento — o que sobrou do
// ciclo anterior mais o que ela comprou desde então. Não é "o que comprou na
// semana": a planilha que isso substitui mostra o em aberto da semana 1 virando
// base do previsto da semana 2, e é assim que a cobrança funciona.

export interface LinhaFechamento {
  clienteId: number;
  clienteNome: string;
  previsto: number;
  recebido: number;
  desconto: number;
  emAberto: number;
  lojas: string[];
}

export interface Fechamento {
  id: number | null;
  de: string;
  ate: string;
  observacao: string | null;
  fechadoEm: string | null;
  linhas: LinhaFechamento[];
  // cliente desligado que ainda tem saldo: fica fora da cobranca, mas aparece
  foraDaCobranca?: LinhaFechamento[];
}

// Quando começa o próximo ciclo: o dia seguinte ao fim do último fechamento.
// Não havendo nenhum, o primeiro dia com pedido — não adianta abrir um ciclo
// vazio antes de existir venda.
export async function proximoPeriodo(): Promise<{ de: string; ate: string }> {
  const { rows } = await pool.query<{ ate: string }>(
    "SELECT ate FROM fabrica_fechamentos ORDER BY ate DESC, id DESC LIMIT 1"
  );
  let de: string;
  if (rows[0]) {
    const d = new Date(`${dataIso(rows[0].ate)}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    de = d.toISOString().slice(0, 10);
  } else {
    const { rows: p } = await pool.query<{ primeira: string | null }>(
      "SELECT MIN(data) AS primeira FROM fabrica_pedidos WHERE status <> 'CANCELADO'"
    );
    de = p[0]?.primeira ? dataIso(p[0].primeira) : new Date().toISOString().slice(0, 10);
  }
  return { de, ate: new Date().toISOString().slice(0, 10) };
}

// Monta o fechamento do período sem gravar nada.
//
// `previsto` sai da conta-corrente inteira, não só do período: é dívida
// acumulada. `recebido` e `desconto` são do período, porque é o que entrou neste
// ciclo.
export async function montarFechamento(de: string, ate: string): Promise<Fechamento> {
  const contas = await listarContaCorrente();
  // Saldo NA DATA do fechamento, não o de hoje.
  //
  // A conta-corrente é sempre "agora". Fechar um ciclo atrasado — que é
  // justamente o caso quando feriado ou falta empurram o dia — mostraria o saldo
  // de hoje com o rótulo de outra data, e a loja receberia uma cobrança que não
  // corresponde a período nenhum.
  const [{ rows: compradoAte }, { rows: pagoAte }, { rows: pagos }] = await Promise.all([
    pool.query<{ cliente_id: number; total: string }>(
      `SELECT p.cliente_id, SUM(i.quantidade * i.preco_unitario) AS total
         FROM fabrica_pedidos p JOIN fabrica_pedido_itens i ON i.pedido_id = p.id
        WHERE p.status <> 'CANCELADO' AND p.data <= $1::date
        GROUP BY p.cliente_id`,
      [ate]
    ),
    pool.query<{ cliente_id: number; total: string }>(
      `SELECT cliente_id, SUM(valor) AS total FROM fabrica_pagamentos
        WHERE data <= $1::date GROUP BY cliente_id`,
      [ate]
    ),
    pool.query<{ cliente_id: number; total: string }>(
      `SELECT cliente_id, SUM(valor) AS total FROM fabrica_pagamentos
        WHERE data >= $1::date AND data <= $2::date GROUP BY cliente_id`,
      [de, ate]
    ),
  ]);
  const compNa = new Map(compradoAte.map((r) => [r.cliente_id, Number(r.total)]));
  const pagoNa = new Map(pagoAte.map((r) => [r.cliente_id, Number(r.total)]));
  const pagoNoPeriodo = new Map(pagos.map((r) => [r.cliente_id, Number(r.total)]));

  // Fora do ciclo semanal: quem compra esporadico e paga na hora, e quem foi
  // desligado.
  //
  // Sai da tabela, mas nao some do relatorio: o que ficou de fora vai separado,
  // com nome e valor. Saldo que desaparece calado e como a receita fantasma —
  // ninguem procura o que nao aparece.
  const foraDaCobranca: LinhaFechamento[] = [];

  const porPagante = new Map<number, LinhaFechamento>();
  for (const c of contas) {
    if (!c.ativo || !c.naCobranca) {
      const carregadaI = -((c.credito ?? 0) + (c.creditoConta ?? 0));
      const saldoI =
        (compNa.get(c.clienteId) ?? 0) - (pagoNa.get(c.clienteId) ?? 0) + carregadaI;
      const recebidoI = pagoNoPeriodo.get(c.clienteId) ?? 0;
      if (saldoI !== 0 || recebidoI !== 0) {
        foraDaCobranca.push({
          clienteId: c.clienteId,
          clienteNome: c.clienteNome,
          previsto: saldoI + recebidoI,
          recebido: recebidoI,
          desconto: 0,
          emAberto: saldoI,
          lojas: [],
        });
      }
      continue;
    }
    const atual = porPagante.get(c.paganteId) ?? {
      clienteId: c.paganteId,
      clienteNome: c.paganteNome,
      previsto: 0,
      recebido: 0,
      desconto: 0,
      emAberto: 0,
      lojas: [],
    };
    // saldo naquela data: comprado ate ali, menos pago ate ali, mais o que a
    // loja ja devia antes de o site existir. Os creditos vem da conta-corrente
    // porque nao tem data propria.
    const carregada = -((c.credito ?? 0) + (c.creditoConta ?? 0));
    const saldoNaData =
      (compNa.get(c.clienteId) ?? 0) - (pagoNa.get(c.clienteId) ?? 0) + carregada;
    // previsto = o que ela devia antes de pagar neste ciclo
    atual.previsto += saldoNaData + (pagoNoPeriodo.get(c.clienteId) ?? 0);
    atual.recebido += pagoNoPeriodo.get(c.clienteId) ?? 0;
    // DESCONTOS na planilha e antecipacao, nao desconto sobre a venda: a loja
    // pagou adiantado e leva credito, ou ganhou a bonificacao de 3,5% por pagar
    // em dia. Credito de devolucao entra junto — pra loja e a mesma coisa, ela
    // tira menos dinheiro do bolso na terca.
    //
    // So o credito POSITIVO: `creditoConta` negativo e divida carregada, o
    // contrario de desconto, e somar isso aqui viraria abatimento do nada.
    atual.desconto += (c.credito ?? 0) + Math.max(0, c.creditoConta ?? 0);
    atual.emAberto += saldoNaData;
    if (c.comprado > 0 || c.saldo !== 0) atual.lojas.push(c.clienteNome);
    porPagante.set(c.paganteId, atual);
  }

  const linhas = [...porPagante.values()]
    .filter((l) => l.previsto !== 0 || l.recebido !== 0 || l.emAberto !== 0)
    .sort((a, b) => b.emAberto - a.emAberto);
  return {
    id: null,
    de,
    ate,
    observacao: null,
    fechadoEm: null,
    linhas,
    foraDaCobranca: foraDaCobranca.sort((a, b) => b.emAberto - a.emAberto),
  };
}

export async function gravarFechamento(
  de: string,
  ate: string,
  observacao: string | null
): Promise<{ id: number }> {
  const f = await montarFechamento(de, ate);
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    const { rows } = await cliente.query<{ id: number }>(
      "INSERT INTO fabrica_fechamentos (de, ate, observacao) VALUES ($1::date, $2::date, $3) RETURNING id",
      [de, ate, observacao]
    );
    const id = rows[0].id;
    for (const l of f.linhas) {
      await cliente.query(
        `INSERT INTO fabrica_fechamento_linhas
           (fechamento_id, cliente_id, previsto, recebido, desconto, em_aberto)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, l.clienteId, l.previsto, l.recebido, l.desconto, l.emAberto]
      );
    }
    await cliente.query("COMMIT");
    return { id };
  } catch (err) {
    await cliente.query("ROLLBACK");
    throw err;
  } finally {
    cliente.release();
  }
}

export async function listarFechamentos(limite = 30): Promise<Fechamento[]> {
  const { rows } = await pool.query<{
    id: number;
    de: string;
    ate: string;
    observacao: string | null;
    fechado_em: string;
  }>(
    "SELECT id, de, ate, observacao, fechado_em FROM fabrica_fechamentos ORDER BY ate DESC, id DESC LIMIT $1",
    [Math.min(Math.max(limite, 1), 200)]
  );
  if (!rows.length) return [];
  const { rows: linhas } = await pool.query<{
    fechamento_id: number;
    cliente_id: number;
    nome: string;
    previsto: string;
    recebido: string;
    desconto: string;
    em_aberto: string;
  }>(
    `SELECT l.fechamento_id, l.cliente_id, c.nome, l.previsto, l.recebido, l.desconto, l.em_aberto
       FROM fabrica_fechamento_linhas l
       JOIN fabrica_clientes c ON c.id = l.cliente_id
      WHERE l.fechamento_id = ANY($1::int[])
      ORDER BY l.em_aberto DESC`,
    [rows.map((r) => r.id)]
  );
  return rows.map((r) => ({
    id: r.id,
    de: dataIso(r.de),
    ate: dataIso(r.ate),
    observacao: r.observacao,
    fechadoEm: r.fechado_em,
    linhas: linhas
      .filter((l) => l.fechamento_id === r.id)
      .map((l) => ({
        clienteId: l.cliente_id,
        clienteNome: l.nome,
        previsto: Number(l.previsto),
        recebido: Number(l.recebido),
        desconto: Number(l.desconto),
        emAberto: Number(l.em_aberto),
        lojas: [],
      })),
  }));
}

export async function excluirFechamento(id: number): Promise<void> {
  await pool.query("DELETE FROM fabrica_fechamentos WHERE id = $1", [id]);
}
