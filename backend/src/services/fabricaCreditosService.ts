import { pool } from "../db/pool";
import { dataIso } from "./fabricaData";

// Crédito do cliente na Fábrica Distribuidora.
//
// A loja acumula crédito de dois jeitos e usa em qualquer cobrança futura:
//
//   ANTECIPACAO  paga adiantado. A Mestre antecipou R$ 400 mil em 4 meses.
//   BONIFICACAO  3,5% sobre o pagamento, só quando quita 100% do fechamento.
//
// Devolução também gera crédito, mas vive em fabrica_devolucoes e não entra
// aqui: os dois somando no mesmo saldo abateriam a mercadoria duas vezes.
//
// Nada disso é desconto sobre a venda: a venda aconteceu pelo valor cheio.
// Tratar como redução de receita faria a fábrica parecer que vendeu menos do
// que vendeu — é pagamento vindo de outro lugar.
//
// O saldo não é guardado. Sai da soma dos lançamentos, como todo o resto da
// Fábrica: guardar um saldo é criar um número que pode discordar do extrato.

export type OrigemCredito =
  | "ANTECIPACAO"
  | "BONIFICACAO"
  | "AJUSTE"
  | "USO"
  // o que a loja já devia quando o sistema começou. Sempre negativo: crédito
  // negativo é dívida, e o saldo da conta corrente já subtrai esta coluna.
  | "SALDO_ANTERIOR";

export interface Credito {
  id: number;
  clienteId: number;
  clienteNome: string;
  data: string;
  origem: OrigemCredito;
  valor: number;
  pagamentoId: number | null;
  observacao: string | null;
}

export interface SaldoCliente {
  clienteId: number;
  clienteNome: string;
  // quem paga por esta loja — o crédito segue quem paga
  clientePaiId: number | null;
  clientePaiNome: string | null;
  antecipado: number;
  bonificado: number;
  ajuste: number;
  // dívida que a loja trouxe de antes do sistema. Sempre negativo.
  anterior: number;
  usado: number;
  saldo: number;
}

interface Linha {
  id: number;
  cliente_id: number;
  cliente_nome: string;
  data: string;
  origem: string;
  valor: string;
  pagamento_id: number | null;
  observacao: string | null;
}

export interface CreditoEntrada {
  clienteId: number;
  data: string;
  origem: OrigemCredito;
  valor: number;
  pagamentoId: number | null;
  observacao: string | null;
}

export async function percentualBonificacao(): Promise<number> {
  const { rows } = await pool.query<{ percentual: string }>(
    "SELECT percentual FROM fabrica_bonificacao WHERE id = 1"
  );
  return rows[0] ? Number(rows[0].percentual) : 3.5;
}

export async function definirPercentualBonificacao(percentual: number): Promise<void> {
  await pool.query(
    `INSERT INTO fabrica_bonificacao (id, percentual, atualizado_em)
     VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET percentual = $1, atualizado_em = now()`,
    [percentual]
  );
}

export async function listarCreditos(clienteId?: number): Promise<Credito[]> {
  const { rows } = await pool.query<Linha>(
    `SELECT cr.id, cr.cliente_id, c.nome AS cliente_nome, cr.data, cr.origem, cr.valor,
            cr.pagamento_id, cr.observacao
     FROM fabrica_creditos cr
     JOIN fabrica_clientes c ON c.id = cr.cliente_id
     ${clienteId ? "WHERE cr.cliente_id = $1" : ""}
     ORDER BY cr.data DESC, cr.id DESC`,
    clienteId ? [clienteId] : []
  );
  return rows.map((r) => ({
    id: r.id,
    clienteId: r.cliente_id,
    clienteNome: r.cliente_nome,
    data: dataIso(r.data),
    origem: r.origem as OrigemCredito,
    valor: Number(r.valor),
    pagamentoId: r.pagamento_id,
    observacao: r.observacao,
  }));
}

export async function saldosPorCliente(): Promise<SaldoCliente[]> {
  const { rows } = await pool.query<{
    cliente_id: number;
    cliente_nome: string;
    cliente_pai_id: number | null;
    cliente_pai_nome: string | null;
    antecipado: string;
    bonificado: string;
    ajuste: string;
    anterior: string;
    usado: string;
    saldo: string;
  }>(
    `SELECT c.id AS cliente_id, c.nome AS cliente_nome,
            c.cliente_pai_id, p.nome AS cliente_pai_nome,
            COALESCE(SUM(cr.valor) FILTER (WHERE cr.origem = 'ANTECIPACAO'), 0) AS antecipado,
            COALESCE(SUM(cr.valor) FILTER (WHERE cr.origem = 'BONIFICACAO'), 0) AS bonificado,
            COALESCE(SUM(cr.valor) FILTER (WHERE cr.origem = 'AJUSTE'), 0)      AS ajuste,
            COALESCE(SUM(cr.valor) FILTER (WHERE cr.origem = 'SALDO_ANTERIOR'), 0) AS anterior,
            COALESCE(SUM(cr.valor) FILTER (WHERE cr.origem = 'USO'), 0)         AS usado,
            COALESCE(SUM(cr.valor), 0)                                          AS saldo
     FROM fabrica_clientes c
     LEFT JOIN fabrica_clientes p ON p.id = c.cliente_pai_id
     LEFT JOIN fabrica_creditos cr ON cr.cliente_id = c.id
     GROUP BY c.id, c.nome, c.cliente_pai_id, p.nome
     HAVING COALESCE(SUM(cr.valor), 0) <> 0
         OR COUNT(cr.id) FILTER (WHERE cr.origem = 'SALDO_ANTERIOR') > 0
     ORDER BY COALESCE(SUM(cr.valor), 0) DESC`
  );
  return rows.map((r) => ({
    clienteId: r.cliente_id,
    clienteNome: r.cliente_nome,
    clientePaiId: r.cliente_pai_id,
    clientePaiNome: r.cliente_pai_nome,
    antecipado: Number(r.antecipado),
    bonificado: Number(r.bonificado),
    ajuste: Number(r.ajuste),
    anterior: Number(r.anterior),
    usado: Number(r.usado),
    saldo: Number(r.saldo),
  }));
}

export async function saldoDoCliente(clienteId: number): Promise<number> {
  const { rows } = await pool.query<{ saldo: string }>(
    `SELECT COALESCE(SUM(valor), 0) AS saldo
     FROM fabrica_creditos WHERE cliente_id = $1`,
    [clienteId]
  );
  return Number(rows[0]?.saldo ?? 0);
}

export async function criarCredito(e: CreditoEntrada): Promise<{ id: number }> {
  // O sinal sai da origem, nunca de quem digita: deixar isso na mão de quem
  // lança é convidar o saldo a andar pro lado errado. USO e SALDO_ANTERIOR
  // sempre tiram; o resto sempre soma. AJUSTE é o único que aceita os dois,
  // porque é exatamente pra consertar o que os outros erraram.
  const valor =
    e.origem === "USO" || e.origem === "SALDO_ANTERIOR"
      ? -Math.abs(e.valor)
      : e.origem === "AJUSTE"
        ? e.valor
        : Math.abs(e.valor);
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO fabrica_creditos
       (cliente_id, data, origem, valor, pagamento_id, observacao)
     VALUES ($1, $2::date, $3, $4, $5, $6) RETURNING id`,
    [e.clienteId, e.data, e.origem, valor, e.pagamentoId, e.observacao]
  );
  return { id: rows[0].id };
}

export async function excluirCredito(id: number): Promise<void> {
  await pool.query("DELETE FROM fabrica_creditos WHERE id = $1", [id]);
}

// Antecipação: entra o dinheiro adiantado E a bonificação sobre ele, numa
// transação só. São dois lançamentos porque são duas coisas — o que ela pagou
// e o prêmio por ter pago antes —, e separá-los é o que deixa auditar os 3,5%.
export async function lancarAntecipacao(
  clienteId: number,
  data: string,
  valor: number,
  observacao: string | null
): Promise<{ antecipacao: number; bonificacao: number; percentual: number }> {
  const percentual = await percentualBonificacao();
  const bonus = Number(((valor * percentual) / 100).toFixed(2));

  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    await cliente.query(
      `INSERT INTO fabrica_creditos (cliente_id, data, origem, valor, observacao)
       VALUES ($1, $2::date, 'ANTECIPACAO', $3, $4)`,
      [clienteId, data, Math.abs(valor), observacao]
    );
    await cliente.query(
      `INSERT INTO fabrica_creditos (cliente_id, data, origem, valor, observacao)
       VALUES ($1, $2::date, 'BONIFICACAO', $3, $4)`,
      [clienteId, data, bonus, `${percentual}% sobre a antecipação de ${valor.toFixed(2)}`]
    );
    await cliente.query("COMMIT");
  } catch (err) {
    await cliente.query("ROLLBACK");
    throw err;
  } finally {
    cliente.release();
  }
  return { antecipacao: Math.abs(valor), bonificacao: bonus, percentual };
}

// Aqui havia `bonificarPagamento`, que gravava os 3,5% dentro da transação de
// cada pagamento. Saiu em 30/10/2026, três dias depois da regra que a tornou
// desnecessária — o fechamento do mês, mais abaixo, conta por quê.

// Aqui havia o alerta de crédito provisório e o botão que o derrubava.
//
// Nada disso tinha mais o que mostrar. O provisório existia pra uma regra que
// vigorou até 04/09/2026: a loja levava os 3,5% ao pagar, mas o crédito só
// virava dela zerando a conta. Depois disso o único lugar que gravava
// `provisorio = TRUE` era `bonificarPagamento`, que saiu em 30/10/2026.
// Conferido no banco antes de tirar: zero linhas provisórias. O alerta ficava
// aceso em branco e o botão não tinha o que apagar.
//
// A coluna continua no schema, sem ninguém filtrando por ela. Saiu do código,
// não do banco: está toda FALSE, não carrega informação nenhuma, e um DROP em
// produção pra arrumar código morto não se paga.

// ---------------------------------------------------------------------------
// Fechamento do mês: os 3,5% de uma vez só, no último dia.
//
// A regra, nas palavras do Hudson em 27/10/2026: "se comprar 500 mil e pagar
// 300 mil, recebe 3,5% em cima de 300 mil; se comprou 300 mil e pagou 500 mil,
// é pago 3,5% em cima de 500 mil. Ele sempre vai receber, somente quando
// pagar." Ou seja: a base é o dinheiro que entrou no mês, e só ele. O que ela
// comprou não entra na conta, nem pra mais nem pra menos.
//
// Isso derruba duas coisas que o código fazia:
//
//   - a trava de saldo que havia no caminho do pagamento ("não devia nada,
//     então não bonifica"). Pagar mais do que devia passou a valer prêmio igual.
//   - o crédito nascendo colado em cada pagamento. Espalhado em 69 linhas no
//     mês, ninguém confere; e quem entrou pelo extrato ficava de fora sem que
//     a loja tivesse como saber por qual porta o dinheiro dela passou.
//
// O código acompanhou a regra em 30/10/2026: os dois caminhos que ainda
// geravam o crédito na hora — o lançamento pela tela e a importação do extrato
// Pix — deixaram de gerar. O total nunca dobrou, porque o fechamento apaga a
// BONIFICACAO do mês antes de gravar; o que incomodava era o extrato da loja
// mostrando, até o dia 31, linhas que iam ser substituídas.
//
// A base soma os dois jeitos de o dinheiro entrar, e só esses dois: pagamento
// e antecipação. Não existe dupla contagem entre eles — a antecipação lançada
// pela tela vive em fabrica_creditos, e o adiantamento que vem do extrato Pix
// vive em fabrica_pagamentos.

export interface LinhaBonificacaoMes {
  clienteId: number;
  clienteNome: string;
  pagamentos: number;
  antecipado: number;
  pago: number;
  bonus: number;
  // o que já existe de BONIFICACAO lançado nesse mês, venha de onde vier
  jaLancado: number;
  diferenca: number;
}

export interface BonificacaoMes {
  mes: string;
  ultimoDia: string;
  percentual: number;
  // o mês ainda está correndo: fechar agora deixa de fora o que entrar depois
  mesAberto: boolean;
  linhas: LinhaBonificacaoMes[];
  pago: number;
  bonus: number;
  jaLancado: number;
}

function limitesDoMes(mes: string): { primeiro: string; ultimo: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(mes);
  if (!m) throw new Error("Mês inválido. Use AAAA-MM.");
  const ano = Number(m[1]);
  const num = Number(m[2]);
  if (num < 1 || num > 12) throw new Error("Mês inválido. Use AAAA-MM.");
  // dia 0 do mês seguinte é o último dia deste, e acerta fevereiro sozinho
  const fim = new Date(Date.UTC(ano, num, 0));
  return { primeiro: `${mes}-01`, ultimo: fim.toISOString().slice(0, 10) };
}

export async function previaBonificacaoMes(mes: string): Promise<BonificacaoMes> {
  const { primeiro, ultimo } = limitesDoMes(mes);
  const percentual = await percentualBonificacao();

  const { rows } = await pool.query<{
    cliente_id: number;
    cliente_nome: string;
    pagamentos: string;
    pago: string;
    antecipado: string;
    ja_lancado: string;
  }>(
    `WITH pag AS (
       SELECT cliente_id, COUNT(*) AS pagamentos, SUM(valor) AS pago
         FROM fabrica_pagamentos
        WHERE data BETWEEN $1::date AND $2::date
        GROUP BY cliente_id
     ),
     ant AS (
       SELECT cliente_id, SUM(valor) AS antecipado
         FROM fabrica_creditos
        WHERE origem = 'ANTECIPACAO' AND data BETWEEN $1::date AND $2::date
        GROUP BY cliente_id
     ),
     bon AS (
       SELECT cliente_id, SUM(valor) AS ja_lancado
         FROM fabrica_creditos
        WHERE origem = 'BONIFICACAO' AND data BETWEEN $1::date AND $2::date
        GROUP BY cliente_id
     )
     SELECT c.id AS cliente_id,
            c.nome AS cliente_nome,
            COALESCE(pag.pagamentos, 0) AS pagamentos,
            COALESCE(pag.pago, 0) AS pago,
            COALESCE(ant.antecipado, 0) AS antecipado,
            COALESCE(bon.ja_lancado, 0) AS ja_lancado
       FROM fabrica_clientes c
       LEFT JOIN pag ON pag.cliente_id = c.id
       LEFT JOIN ant ON ant.cliente_id = c.id
       LEFT JOIN bon ON bon.cliente_id = c.id
      WHERE COALESCE(pag.pago, 0) <> 0
         OR COALESCE(ant.antecipado, 0) <> 0
         OR COALESCE(bon.ja_lancado, 0) <> 0
      ORDER BY COALESCE(pag.pago, 0) + COALESCE(ant.antecipado, 0) DESC`,
    [primeiro, ultimo]
  );

  const linhas: LinhaBonificacaoMes[] = rows.map((r) => {
    const pago = Number(r.pago) + Number(r.antecipado);
    const bonus = Number(((pago * percentual) / 100).toFixed(2));
    const jaLancado = Number(r.ja_lancado);
    return {
      clienteId: r.cliente_id,
      clienteNome: r.cliente_nome,
      pagamentos: Number(r.pagamentos),
      antecipado: Number(r.antecipado),
      pago,
      bonus,
      jaLancado,
      diferenca: Number((bonus - jaLancado).toFixed(2)),
    };
  });

  const soma = (f: (l: LinhaBonificacaoMes) => number) =>
    Number(linhas.reduce((s, l) => s + f(l), 0).toFixed(2));

  return {
    mes,
    ultimoDia: ultimo,
    percentual,
    mesAberto: new Date().toISOString().slice(0, 10) < ultimo,
    linhas,
    pago: soma((l) => l.pago),
    bonus: soma((l) => l.bonus),
    jaLancado: soma((l) => l.jaLancado),
  };
}

// Fecha o mês: apaga o que havia de BONIFICACAO naquele mês e grava uma linha
// por loja, no último dia.
//
// Apagar antes de gravar é o que torna seguro rodar duas vezes. Sem isso, o
// segundo clique dobraria o prêmio de todo mundo — e foi exatamente assim que
// 14 bonificações apareceram de surpresa em 26/10/2026. Só mexe em linhas
// BONIFICACAO dentro do mês pedido: antecipação, ajuste e saldo anterior do
// mesmo período ficam onde estão.
export async function fecharBonificacaoMes(
  mes: string
): Promise<{ apagados: number; criados: number; total: number; ultimoDia: string }> {
  const previa = await previaBonificacaoMes(mes);
  const { primeiro, ultimo } = limitesDoMes(mes);

  const cliente = await pool.connect();
  let apagados = 0;
  let criados = 0;
  let total = 0;
  try {
    await cliente.query("BEGIN");
    const del = await cliente.query(
      `DELETE FROM fabrica_creditos
        WHERE origem = 'BONIFICACAO' AND data BETWEEN $1::date AND $2::date`,
      [primeiro, ultimo]
    );
    apagados = del.rowCount ?? 0;

    for (const l of previa.linhas) {
      if (l.bonus <= 0) continue;
      await cliente.query(
        `INSERT INTO fabrica_creditos
           (cliente_id, data, origem, valor, observacao)
         VALUES ($1, $2::date, 'BONIFICACAO', $3, $4)`,
        [
          l.clienteId,
          ultimo,
          l.bonus,
          `${previa.percentual}% sobre R$ ${l.pago.toFixed(2)} pagos em ${mes}`,
        ]
      );
      criados++;
      total += l.bonus;
    }
    await cliente.query("COMMIT");
  } catch (err) {
    await cliente.query("ROLLBACK");
    throw err;
  } finally {
    cliente.release();
  }
  return { apagados, criados, total: Number(total.toFixed(2)), ultimoDia: ultimo };
}
