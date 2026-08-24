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

export type OrigemCredito = "ANTECIPACAO" | "BONIFICACAO" | "AJUSTE" | "USO";

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
    usado: string;
    saldo: string;
  }>(
    `SELECT c.id AS cliente_id, c.nome AS cliente_nome,
            c.cliente_pai_id, p.nome AS cliente_pai_nome,
            COALESCE(SUM(cr.valor) FILTER (WHERE cr.origem = 'ANTECIPACAO'), 0) AS antecipado,
            COALESCE(SUM(cr.valor) FILTER (WHERE cr.origem = 'BONIFICACAO'), 0) AS bonificado,
            COALESCE(SUM(cr.valor) FILTER (WHERE cr.origem = 'AJUSTE'), 0)      AS ajuste,
            COALESCE(SUM(cr.valor) FILTER (WHERE cr.origem = 'USO'), 0)         AS usado,
            COALESCE(SUM(cr.valor), 0)                                          AS saldo
     FROM fabrica_clientes c
     LEFT JOIN fabrica_clientes p ON p.id = c.cliente_pai_id
     LEFT JOIN fabrica_creditos cr ON cr.cliente_id = c.id
     GROUP BY c.id, c.nome, c.cliente_pai_id, p.nome
     HAVING COALESCE(SUM(cr.valor), 0) <> 0
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
    usado: Number(r.usado),
    saldo: Number(r.saldo),
  }));
}

export async function saldoDoCliente(clienteId: number): Promise<number> {
  const { rows } = await pool.query<{ saldo: string }>(
    "SELECT COALESCE(SUM(valor), 0) AS saldo FROM fabrica_creditos WHERE cliente_id = $1",
    [clienteId]
  );
  return Number(rows[0]?.saldo ?? 0);
}

export async function criarCredito(e: CreditoEntrada): Promise<{ id: number }> {
  // USO é sempre negativo e o resto sempre positivo: deixar o sinal por conta
  // de quem digita é convidar o saldo a andar pro lado errado
  const valor = e.origem === "USO" ? -Math.abs(e.valor) : Math.abs(e.valor);
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

// Bonificação por pagar em dia: 3,5% sobre o que a loja pagou, e só quando o
// pagamento zera a conta. Pagou 90 de 100 e não ganha nada — é essa a regra
// que faz o prêmio valer alguma coisa.
//
// Roda dentro da transação do pagamento: bonificar e depois falhar deixaria
// crédito de um pagamento que não existe.
export async function bonificarSeQuitou(
  cliente: PoolClient,
  clienteId: number,
  pagamentoId: number,
  valorPago: number,
  data: string,
  saldoAntes: number,
  saldoDepois: number
): Promise<number> {
  // não havia dívida: isso é antecipação, e a bonificação dela já sai por
  // lancarAntecipacao. Bonificar aqui pagaria o prêmio duas vezes.
  if (saldoAntes <= 0.01) return 0;
  // um centavo de folga: NUMERIC fecha certinho, mas o saldo passa por Number()
  if (saldoDepois > 0.01) return 0;

  const cfg = await cliente.query<{ percentual: string }>(
    "SELECT percentual FROM fabrica_bonificacao WHERE id = 1"
  );
  const percentual = cfg.rows[0] ? Number(cfg.rows[0].percentual) : 3.5;
  const bonus = Number(((valorPago * percentual) / 100).toFixed(2));
  if (bonus <= 0) return 0;

  await cliente.query(
    `INSERT INTO fabrica_creditos (cliente_id, data, origem, valor, pagamento_id, observacao)
     VALUES ($1, $2::date, 'BONIFICACAO', $3, $4, $5)`,
    [
      clienteId,
      data,
      bonus,
      pagamentoId,
      `${percentual}% por quitar 100% do fechamento`,
    ]
  );
  return bonus;
}
