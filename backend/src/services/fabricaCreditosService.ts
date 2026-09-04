import type { PoolClient } from "pg";
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
  // pagou parte e já levou os 3,5%, mas ainda não quitou. Vira definitivo no
  // pagamento que zerar a conta, ou some se ela virar o mês devendo.
  provisorio: boolean;
}

// Loja que está com crédito provisório e ainda deve. É a lista que aparece no
// alerta pra decidir se o crédito fica ou sai.
export interface AlertaProvisorio {
  clienteId: number;
  clienteNome: string;
  provisorio: number;
  // quanto ela ainda deve — vem do saldo da conta corrente
  devendo: number;
  // mês do crédito mais antigo ainda pendurado, "AAAA-MM"
  mesMaisAntigo: string;
  // o mês do crédito já virou e a dívida continua: é este que o Hudson quer ver
  venceu: boolean;
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
  // bonificação pendurada: aparece, mas não abate até a loja quitar
  provisorio: number;
  // o que de fato abate hoje — só o que já está confirmado
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
  provisorio: boolean;
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
            cr.pagamento_id, cr.observacao, cr.provisorio
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
    provisorio: r.provisorio,
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
    provisorio: string;
    saldo: string;
  }>(
    `SELECT c.id AS cliente_id, c.nome AS cliente_nome,
            c.cliente_pai_id, p.nome AS cliente_pai_nome,
            COALESCE(SUM(cr.valor) FILTER (WHERE cr.origem = 'ANTECIPACAO'), 0) AS antecipado,
            COALESCE(SUM(cr.valor) FILTER (WHERE cr.origem = 'BONIFICACAO'), 0) AS bonificado,
            COALESCE(SUM(cr.valor) FILTER (WHERE cr.origem = 'AJUSTE'), 0)      AS ajuste,
            COALESCE(SUM(cr.valor) FILTER (WHERE cr.origem = 'SALDO_ANTERIOR'), 0) AS anterior,
            COALESCE(SUM(cr.valor) FILTER (WHERE cr.origem = 'USO'), 0)         AS usado,
            COALESCE(SUM(cr.valor) FILTER (WHERE cr.provisorio), 0)             AS provisorio,
            COALESCE(SUM(cr.valor) FILTER (WHERE NOT cr.provisorio), 0)         AS saldo
     FROM fabrica_clientes c
     LEFT JOIN fabrica_clientes p ON p.id = c.cliente_pai_id
     LEFT JOIN fabrica_creditos cr ON cr.cliente_id = c.id
     GROUP BY c.id, c.nome, c.cliente_pai_id, p.nome
     HAVING COALESCE(SUM(cr.valor), 0) <> 0
         OR COUNT(cr.id) FILTER (WHERE cr.origem = 'SALDO_ANTERIOR') > 0
     ORDER BY COALESCE(SUM(cr.valor) FILTER (WHERE NOT cr.provisorio), 0) DESC`
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
    provisorio: Number(r.provisorio),
    saldo: Number(r.saldo),
  }));
}

export async function saldoDoCliente(clienteId: number): Promise<number> {
  const { rows } = await pool.query<{ saldo: string }>(
    `SELECT COALESCE(SUM(valor), 0) AS saldo
     FROM fabrica_creditos WHERE cliente_id = $1 AND NOT provisorio`,
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

// Bonificação: 3,5% sobre o que a loja pagou, em qualquer pagamento.
//
// **O prêmio é por pagar, não por quitar.** Pagou 90 de 100, leva os 3,5% dos
// 90, definitivo. Não existe mais crédito provisório.
//
// Era o contrário até 04/09/2026: o crédito ficava provisório e só virava dela
// zerando a conta, o que dava à loja um motivo pra fechar a dívida em vez de
// pagar sempre um pedaço. O Hudson trocou a regra sabendo do custo — no período
// de 27/07 a 06/09 a diferença era R$ 127.065,13 contra R$ 10.500,00. A escolha
// foi premiar o fluxo de caixa.
//
// Roda dentro da transação do pagamento: bonificar e depois falhar deixaria
// crédito de um pagamento que não existe.
export async function bonificarPagamento(
  cliente: PoolClient,
  clienteId: number,
  pagamentoId: number,
  valorPago: number,
  data: string,
  saldoAntes: number
): Promise<{ bonus: number; provisorio: boolean; confirmados: number }> {
  // não havia dívida: isso é antecipação, e a bonificação dela já sai por
  // lancarAntecipacao. Bonificar aqui pagaria o prêmio duas vezes.
  if (saldoAntes <= 0.01) return { bonus: 0, provisorio: false, confirmados: 0 };


  const cfg = await cliente.query<{ percentual: string }>(
    "SELECT percentual FROM fabrica_bonificacao WHERE id = 1"
  );
  const percentual = cfg.rows[0] ? Number(cfg.rows[0].percentual) : 3.5;
  const bonus = Number(((valorPago * percentual) / 100).toFixed(2));

  // Provisório de antes da mudança de regra vira definitivo no primeiro
  // pagamento seguinte. Não faz sentido manter parado um crédito que a regra
  // nova já teria liberado no dia em que foi gerado.
  const r = await cliente.query(
    "UPDATE fabrica_creditos SET provisorio = FALSE WHERE cliente_id = $1 AND provisorio",
    [clienteId]
  );
  const confirmados = r.rowCount ?? 0;

  if (bonus <= 0) return { bonus: 0, provisorio: false, confirmados };

  await cliente.query(
    `INSERT INTO fabrica_creditos
       (cliente_id, data, origem, valor, pagamento_id, observacao, provisorio)
     VALUES ($1, $2::date, 'BONIFICACAO', $3, $4, $5, $6)`,
    [
      clienteId,
      data,
      bonus,
      pagamentoId,
      `${percentual}% sobre o pagamento`,
      false,
    ]
  );
  return { bonus, provisorio: false, confirmados };
}

// Lojas com crédito provisório pendurado e conta ainda aberta.
//
// `venceu` é a regra que o Hudson pediu: o mês do crédito já virou e ela não
// quitou o anterior. Aí o alerta acende e o botão de excluir aparece.
export async function alertasProvisorios(
  devendoPorCliente: Map<number, number>
): Promise<AlertaProvisorio[]> {
  const { rows } = await pool.query<{
    cliente_id: number;
    cliente_nome: string;
    total: string;
    mais_antigo: string;
  }>(
    `SELECT cr.cliente_id, c.nome AS cliente_nome,
            SUM(cr.valor) AS total,
            to_char(MIN(cr.data), 'YYYY-MM') AS mais_antigo
     FROM fabrica_creditos cr
     JOIN fabrica_clientes c ON c.id = cr.cliente_id
     WHERE cr.provisorio
     GROUP BY cr.cliente_id, c.nome
     ORDER BY SUM(cr.valor) DESC`
  );

  // "agora" no fuso da fábrica, não em UTC: no começo da noite o UTC já virou o
  // dia e o mês, e o alerta acenderia um dia antes da hora
  const mesAtual = new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
    .slice(0, 7);

  return rows
    .map((r) => {
      const devendo = devendoPorCliente.get(r.cliente_id) ?? 0;
      return {
        clienteId: r.cliente_id,
        clienteNome: r.cliente_nome,
        provisorio: Number(r.total),
        devendo,
        mesMaisAntigo: r.mais_antigo,
        venceu: devendo > 0.005 && r.mais_antigo < mesAtual,
      };
    })
    // quem já quitou não deveria ter provisório nenhum, mas se sobrar um por
    // exclusão de pagamento ele não precisa virar alerta
    .filter((a) => a.devendo > 0.005);
}

// Tira os provisórios de uma loja. É o botão do alerta: ela não fechou o mês,
// então não leva o prêmio.
export async function excluirProvisorios(clienteId: number): Promise<number> {
  const r = await pool.query(
    "DELETE FROM fabrica_creditos WHERE cliente_id = $1 AND provisorio",
    [clienteId]
  );
  return r.rowCount ?? 0;
}
