import { pool } from "../db/pool";
import { totalAReceber } from "./fabricaPagamentosService";

// Contas a pagar e receber da Fábrica Distribuidora — o barracão da
// fabricação, que paga aluguel, água e luz próprios.
//
// Deliberadamente separado de `contas_lancamentos`, que é das lojas: aquela
// tabela exige `loja_id NOT NULL`. Lançar a água do barracão ali obrigaria a
// escolher uma das 20 lojas, e a despesa da fábrica entraria no resultado
// daquela loja. Não existe "loja fábrica" — a loja chamada Fábrica de Tintas é
// outra coisa: uma loja que compra da fábrica e vende no Mercado Livre.

export type TipoConta = "pagar" | "receber";
export type StatusConta = "pendente" | "pago" | "cancelado";

export interface Conta {
  id: number;
  tipo: TipoConta;
  descricao: string;
  categoria: string | null;
  contraparte: string | null;
  valor: number;
  vencimento: string;
  status: StatusConta;
  dataPagamento: string | null;
  custoFixo: boolean;
  observacao: string | null;
  // derivados
  atrasada: boolean;
  diasParaVencer: number;
}

export interface ContaEntrada {
  tipo: TipoConta;
  descricao: string;
  categoria: string | null;
  contraparte: string | null;
  valor: number;
  vencimento: string;
  status: StatusConta;
  dataPagamento: string | null;
  custoFixo: boolean;
  observacao: string | null;
}

// "hoje" pelo fuso de São Paulo, não pelo UTC. O resto do repo usa
// toISOString().slice(0,10), que vira o dia seguinte depois das 21h e faz
// conta vencida aparecer um dia antes — está documentado como bug conhecido
// no CLAUDE.md, então aqui já nasce certo.
function hoje(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function diasEntre(de: string, ate: string): number {
  const ms = Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

interface Linha {
  id: number;
  tipo: string;
  descricao: string;
  categoria: string | null;
  contraparte: string | null;
  valor: string;
  vencimento: string;
  status: string;
  data_pagamento: string | null;
  custo_fixo: boolean;
  observacao: string | null;
}

function montar(r: Linha): Conta {
  const vencimento = String(r.vencimento).slice(0, 10);
  const status = r.status as StatusConta;
  const diasParaVencer = diasEntre(hoje(), vencimento);
  return {
    id: r.id,
    tipo: r.tipo as TipoConta,
    descricao: r.descricao,
    categoria: r.categoria,
    contraparte: r.contraparte,
    valor: Number(r.valor),
    vencimento,
    status,
    dataPagamento: r.data_pagamento ? String(r.data_pagamento).slice(0, 10) : null,
    custoFixo: r.custo_fixo,
    observacao: r.observacao,
    // conta paga ou cancelada não atrasa, por mais antiga que seja
    atrasada: status === "pendente" && diasParaVencer < 0,
    diasParaVencer,
  };
}

const SELECT_BASE = `
  SELECT c.id, c.tipo, c.descricao, c.categoria, c.contraparte, c.valor, c.vencimento,
         c.status, c.data_pagamento, c.custo_fixo, c.observacao
  FROM fabrica_contas c
`;

export interface FiltroContas {
  tipo?: TipoConta;
  status?: StatusConta;
  de?: string;
  ate?: string;
  limite?: number;
}

export async function listarContas(filtro: FiltroContas = {}): Promise<Conta[]> {
  const condicoes: string[] = [];
  const params: unknown[] = [];
  if (filtro.tipo) {
    params.push(filtro.tipo);
    condicoes.push(`c.tipo = $${params.length}`);
  }
  if (filtro.status) {
    params.push(filtro.status);
    condicoes.push(`c.status = $${params.length}`);
  }
  if (filtro.de) {
    params.push(filtro.de);
    condicoes.push(`c.vencimento >= $${params.length}::date`);
  }
  if (filtro.ate) {
    params.push(filtro.ate);
    condicoes.push(`c.vencimento <= $${params.length}::date`);
  }
  params.push(filtro.limite ?? 300);
  const where = condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : "";
  const { rows } = await pool.query<Linha>(
    `${SELECT_BASE} ${where} ORDER BY c.vencimento DESC, c.id DESC LIMIT $${params.length}`,
    params
  );
  return rows.map(montar);
}

function valores(e: ContaEntrada) {
  return [
    e.tipo,
    e.descricao,
    e.categoria,
    e.contraparte,
    e.valor,
    e.vencimento,
    e.status,
    // pago sem data vira pago hoje: status e data não podem se contradizer
    e.status === "pago" ? (e.dataPagamento ?? hoje()) : null,
    e.custoFixo,
    e.observacao,
  ];
}

// Repetir cria uma conta por mês mantendo o dia do vencimento. Aluguel e
// salário são a mesma conta doze vezes; digitar doze vezes é onde o erro entra.
export async function criarConta(e: ContaEntrada, repetirMeses = 0): Promise<{ ids: number[] }> {
  const ids: number[] = [];
  const total = Math.max(0, Math.min(36, Math.floor(repetirMeses))) + 1;
  const [ano, mes, dia] = e.vencimento.split("-").map(Number);

  for (let i = 0; i < total; i++) {
    // Date.UTC normaliza o estouro de mês sozinho; o dia é preso ao último dia
    // do mês pra 31/01 repetido não pular fevereiro
    const alvo = new Date(Date.UTC(ano, mes - 1 + i, 1));
    const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
    const venc = `${alvo.getUTCFullYear()}-${String(alvo.getUTCMonth() + 1).padStart(2, "0")}-${String(
      Math.min(dia, ultimoDia)
    ).padStart(2, "0")}`;

    // só a primeira parcela nasce com o status informado: repetição é futuro,
    // e futuro não está pago
    const parcela: ContaEntrada = {
      ...e,
      vencimento: venc,
      status: i === 0 ? e.status : "pendente",
      dataPagamento: i === 0 ? e.dataPagamento : null,
    };
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO fabrica_contas
         (tipo, descricao, categoria, contraparte, valor, vencimento, status,
          data_pagamento, custo_fixo, observacao)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8::date,$9,$10) RETURNING id`,
      valores(parcela)
    );
    ids.push(rows[0].id);
  }
  return { ids };
}

export async function atualizarConta(id: number, e: ContaEntrada): Promise<void> {
  await pool.query(
    `UPDATE fabrica_contas
     SET tipo = $2, descricao = $3, categoria = $4, contraparte = $5, valor = $6,
         vencimento = $7::date, status = $8, data_pagamento = $9::date, custo_fixo = $10,
         observacao = $11
     WHERE id = $1`,
    [id, ...valores(e)]
  );
}

export async function definirStatusConta(
  id: number,
  status: StatusConta,
  dataPagamento: string | null
): Promise<void> {
  await pool.query(
    `UPDATE fabrica_contas
     SET status = $2, data_pagamento = CASE WHEN $2 = 'pago' THEN COALESCE($3::date, CURRENT_DATE) ELSE NULL END
     WHERE id = $1`,
    [id, status, dataPagamento]
  );
}

export async function excluirConta(id: number): Promise<void> {
  await pool.query("DELETE FROM fabrica_contas WHERE id = $1", [id]);
}

// Resumo do período: o que a fábrica deve, o que já pagou e o que está atrasado.
export interface ResumoContas {
  aPagar: number;
  aReceber: number;
  pago: number;
  recebido: number;
  atrasado: number;
  custoFixo: number;
  custoVariavel: number;
}

// aReceber não é digitado: é o que as lojas devem, de pedidos menos pagamentos.
// Lançar recebível à mão criaria dois lugares dizendo o mesmo e eles iam
// divergir no primeiro pagamento parcial.
export async function resumoContas(de?: string, ate?: string): Promise<ResumoContas> {
  const [contas, aReceber] = await Promise.all([
    listarContas({ de, ate, limite: 5000 }),
    totalAReceber(),
  ]);
  const resumo: ResumoContas = {
    aPagar: 0,
    aReceber,
    pago: 0,
    recebido: 0,
    atrasado: 0,
    custoFixo: 0,
    custoVariavel: 0,
  };
  for (const c of contas) {
    if (c.status === "cancelado") continue;
    const pendente = c.status === "pendente";
    if (c.tipo === "pagar") {
      if (pendente) resumo.aPagar += c.valor;
      else resumo.pago += c.valor;
      if (c.atrasada) resumo.atrasado += c.valor;
      // fixo x variável conta o gasto do período todo, pago ou não: o DRE
      // olha competência, não caixa
      if (c.custoFixo) resumo.custoFixo += c.valor;
      else resumo.custoVariavel += c.valor;
    } else if (!pendente) {
      resumo.recebido += c.valor;
    }
  }
  return resumo;
}
