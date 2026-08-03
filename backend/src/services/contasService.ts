import { pool } from "../db/pool";

export type TipoLancamento = "pagar" | "receber";
export type StatusLancamento = "pendente" | "pago" | "cancelado";

export interface Lancamento {
  id: number;
  lojaId: number;
  lojaNome: string;
  tipo: TipoLancamento;
  descricao: string;
  categoria: string | null;
  valor: number;
  vencimento: string;
  status: StatusLancamento;
  dataPagamento: string | null;
  observacao: string | null;
  criadoPorId: number | null;
  criadoPorNome: string | null;
  criadoEm: string;
  atualizadoEm: string;
  atrasado: boolean;
  contatoId: number | null;
  contatoNome: string | null;
  grupoParcelamentoId: number | null;
  parcelaNumero: number | null;
  parcelaTotal: number | null;
}

export interface FiltroLancamentos {
  lojaId?: number;
  lojasPermitidas?: number[];
  tipo?: TipoLancamento;
  status?: StatusLancamento;
  dataInicio?: string;
  dataFim?: string;
}

function dataParaISO(valor: unknown): string | null {
  if (!valor) return null;
  return valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor).slice(0, 10);
}

function linhaParaLancamento(r: Record<string, unknown>): Lancamento {
  const vencimento = dataParaISO(r.vencimento) as string;
  const hojeISO = new Date().toISOString().slice(0, 10);
  return {
    id: r.id as number,
    lojaId: r.loja_id as number,
    lojaNome: r.loja_nome as string,
    tipo: r.tipo as TipoLancamento,
    descricao: r.descricao as string,
    categoria: (r.categoria as string | null) ?? null,
    valor: Number(r.valor),
    vencimento,
    status: r.status as StatusLancamento,
    dataPagamento: dataParaISO(r.data_pagamento),
    observacao: (r.observacao as string | null) ?? null,
    criadoPorId: (r.criado_por as number | null) ?? null,
    criadoPorNome: (r.criado_por_nome as string | null) ?? null,
    criadoEm: r.criado_em as string,
    atualizadoEm: r.atualizado_em as string,
    atrasado: r.status === "pendente" && vencimento < hojeISO,
    contatoId: (r.contato_id as number | null) ?? null,
    contatoNome: (r.contato_nome as string | null) ?? null,
    grupoParcelamentoId: (r.grupo_parcelamento_id as number | null) ?? null,
    parcelaNumero: (r.parcela_numero as number | null) ?? null,
    parcelaTotal: (r.parcela_total as number | null) ?? null,
  };
}

// Monta a cláusula WHERE compartilhada por listarLancamentos e a parte
// "em aberto" de calcularResumo. Convenção do projeto é duplicar esse tipo
// de helper por arquivo de rota — aqui as duas funções vivem no mesmo
// arquivo de service, então reaproveitar é natural.
function montarFiltro(f: FiltroLancamentos, params: unknown[]): string {
  const condicoes: string[] = [];
  if (f.lojaId !== undefined) {
    params.push(f.lojaId);
    condicoes.push(`cl.loja_id = $${params.length}`);
  } else if (f.lojasPermitidas !== undefined) {
    params.push(f.lojasPermitidas);
    condicoes.push(`cl.loja_id = ANY($${params.length}::int[])`);
  }
  if (f.tipo !== undefined) {
    params.push(f.tipo);
    condicoes.push(`cl.tipo = $${params.length}`);
  }
  if (f.status !== undefined) {
    params.push(f.status);
    condicoes.push(`cl.status = $${params.length}`);
  }
  if (f.dataInicio !== undefined) {
    params.push(f.dataInicio);
    condicoes.push(`cl.vencimento >= $${params.length}`);
  }
  if (f.dataFim !== undefined) {
    params.push(f.dataFim);
    condicoes.push(`cl.vencimento <= $${params.length}`);
  }
  return condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";
}

export async function listarLancamentos(filtro: FiltroLancamentos): Promise<Lancamento[]> {
  const params: unknown[] = [];
  const where = montarFiltro(filtro, params);
  const { rows } = await pool.query(
    `SELECT cl.*, l.nome AS loja_nome, u.nome AS criado_por_nome, cc.nome AS contato_nome
     FROM contas_lancamentos cl
     JOIN lojas l ON l.id = cl.loja_id
     LEFT JOIN usuarios u ON u.id = cl.criado_por
     LEFT JOIN contas_contatos cc ON cc.id = cl.contato_id
     ${where}
     ORDER BY cl.vencimento ASC, cl.id ASC`,
    params
  );
  return rows.map(linhaParaLancamento);
}

async function buscarLancamentoPorId(id: number): Promise<Lancamento | null> {
  const { rows } = await pool.query(
    `SELECT cl.*, l.nome AS loja_nome, u.nome AS criado_por_nome, cc.nome AS contato_nome
     FROM contas_lancamentos cl
     JOIN lojas l ON l.id = cl.loja_id
     LEFT JOIN usuarios u ON u.id = cl.criado_por
     LEFT JOIN contas_contatos cc ON cc.id = cl.contato_id
     WHERE cl.id = $1`,
    [id]
  );
  return rows[0] ? linhaParaLancamento(rows[0]) : null;
}

export async function obterLojaDoLancamento(id: number): Promise<number | null> {
  const { rows } = await pool.query("SELECT loja_id FROM contas_lancamentos WHERE id = $1", [id]);
  return rows[0]?.loja_id ?? null;
}

export interface NovoLancamento {
  lojaId: number;
  tipo: TipoLancamento;
  descricao: string;
  categoria?: string | null;
  contatoId?: number | null;
  valor: number;
  vencimento: string;
  observacao?: string | null;
}

export async function criarLancamento(criadoPorId: number, dados: NovoLancamento): Promise<Lancamento> {
  const { rows } = await pool.query(
    `INSERT INTO contas_lancamentos (loja_id, tipo, descricao, categoria, contato_id, valor, vencimento, observacao, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      dados.lojaId,
      dados.tipo,
      dados.descricao,
      dados.categoria ?? null,
      dados.contatoId ?? null,
      dados.valor,
      dados.vencimento,
      dados.observacao ?? null,
      criadoPorId,
    ]
  );
  return buscarLancamentoPorId(rows[0].id) as Promise<Lancamento>;
}

// Cria N parcelas: a primeira insere e vira a "âncora" do grupo (seu próprio
// id em grupo_parcelamento_id), as demais seguem com vencimento +1 mês por
// parcela e o mesmo grupo. Loop sequencial (não Promise.all) — poucas linhas,
// sem necessidade de paralelismo, evita disputa de conexão do pool à toa.
export interface NovoLancamentoParcelado {
  lojaId: number;
  tipo: TipoLancamento;
  descricao: string;
  categoria?: string | null;
  contatoId?: number | null;
  valorParcela: number;
  primeiroVencimento: string;
  quantidadeParcelas: number;
  observacao?: string | null;
}

function somarMeses(dataISO: string, meses: number): string {
  const d = new Date(`${dataISO}T00:00:00`);
  d.setMonth(d.getMonth() + meses);
  return d.toISOString().slice(0, 10);
}

export async function criarLancamentoParcelado(criadoPorId: number, dados: NovoLancamentoParcelado): Promise<Lancamento[]> {
  const primeira = await criarLancamento(criadoPorId, {
    lojaId: dados.lojaId,
    tipo: dados.tipo,
    descricao: dados.descricao,
    categoria: dados.categoria,
    contatoId: dados.contatoId,
    valor: dados.valorParcela,
    vencimento: dados.primeiroVencimento,
    observacao: dados.observacao,
  });
  await pool.query(
    "UPDATE contas_lancamentos SET grupo_parcelamento_id = $1, parcela_numero = 1, parcela_total = $2 WHERE id = $1",
    [primeira.id, dados.quantidadeParcelas]
  );

  const parcelas: Lancamento[] = [(await buscarLancamentoPorId(primeira.id)) as Lancamento];
  for (let numero = 2; numero <= dados.quantidadeParcelas; numero++) {
    const { rows } = await pool.query(
      `INSERT INTO contas_lancamentos
         (loja_id, tipo, descricao, categoria, contato_id, valor, vencimento, observacao, criado_por, grupo_parcelamento_id, parcela_numero, parcela_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        dados.lojaId,
        dados.tipo,
        dados.descricao,
        dados.categoria ?? null,
        dados.contatoId ?? null,
        dados.valorParcela,
        somarMeses(dados.primeiroVencimento, numero - 1),
        dados.observacao ?? null,
        criadoPorId,
        primeira.id,
        numero,
        dados.quantidadeParcelas,
      ]
    );
    parcelas.push((await buscarLancamentoPorId(rows[0].id)) as Lancamento);
  }
  return parcelas;
}

export interface AtualizacaoLancamento {
  descricao?: string;
  categoria?: string | null;
  valor?: number;
  vencimento?: string;
  observacao?: string | null;
  status?: StatusLancamento;
  dataPagamento?: string | null;
}

export async function atualizarLancamento(id: number, dados: AtualizacaoLancamento): Promise<Lancamento> {
  const campos: string[] = [];
  const valores: unknown[] = [];
  let i = 1;

  if (dados.descricao !== undefined) {
    campos.push(`descricao = $${i++}`);
    valores.push(dados.descricao);
  }
  if (dados.categoria !== undefined) {
    campos.push(`categoria = $${i++}`);
    valores.push(dados.categoria);
  }
  if (dados.valor !== undefined) {
    campos.push(`valor = $${i++}`);
    valores.push(dados.valor);
  }
  if (dados.vencimento !== undefined) {
    campos.push(`vencimento = $${i++}`);
    valores.push(dados.vencimento);
  }
  if (dados.observacao !== undefined) {
    campos.push(`observacao = $${i++}`);
    valores.push(dados.observacao);
  }
  if (dados.status !== undefined) {
    campos.push(`status = $${i++}`);
    valores.push(dados.status);
  }
  if (dados.dataPagamento !== undefined) {
    campos.push(`data_pagamento = $${i++}`);
    valores.push(dados.dataPagamento);
  }

  if (campos.length === 0) {
    const atual = await buscarLancamentoPorId(id);
    if (!atual) throw new Error("Lançamento não encontrado.");
    return atual;
  }

  campos.push(`atualizado_em = now()`);
  valores.push(id);
  const { rowCount } = await pool.query(`UPDATE contas_lancamentos SET ${campos.join(", ")} WHERE id = $${i}`, valores);
  if (rowCount === 0) throw new Error("Lançamento não encontrado.");
  return buscarLancamentoPorId(id) as Promise<Lancamento>;
}

// Marcar como pago é um atalho semântico sobre atualizarLancamento — seta
// status='pago' e data_pagamento (hoje, se não vier explícita).
export async function marcarComoPago(id: number, dataPagamento?: string): Promise<Lancamento> {
  const data = dataPagamento ?? new Date().toISOString().slice(0, 10);
  return atualizarLancamento(id, { status: "pago", dataPagamento: data });
}

export async function excluirLancamento(id: number): Promise<void> {
  const { rowCount } = await pool.query("DELETE FROM contas_lancamentos WHERE id = $1", [id]);
  if (rowCount === 0) throw new Error("Lançamento não encontrado.");
}

export interface ResumoContas {
  emAbertoPagar: number;
  emAbertoReceber: number;
  atrasadoPagar: number;
  atrasadoReceber: number;
  pagoPeriodo: number;
  recebidoPeriodo: number;
  saldoPeriodo: number;
}

// "Em aberto"/"atrasado" olham todo o cadastro pendente (dívida em aberto
// não tem "período"); "pago/recebido no período" filtra por data_pagamento
// dentro de dataInicio/dataFim quando informados.
export async function calcularResumo(filtro: FiltroLancamentos): Promise<ResumoContas> {
  const paramsAberto: unknown[] = [];
  const whereAberto = montarFiltro(
    { ...filtro, status: undefined, dataInicio: undefined, dataFim: undefined },
    paramsAberto
  );

  const { rows: abertoRows } = await pool.query(
    `SELECT
       COALESCE(SUM(valor) FILTER (WHERE status = 'pendente' AND tipo = 'pagar'), 0) AS em_aberto_pagar,
       COALESCE(SUM(valor) FILTER (WHERE status = 'pendente' AND tipo = 'receber'), 0) AS em_aberto_receber,
       COALESCE(SUM(valor) FILTER (WHERE status = 'pendente' AND tipo = 'pagar' AND vencimento < CURRENT_DATE), 0) AS atrasado_pagar,
       COALESCE(SUM(valor) FILTER (WHERE status = 'pendente' AND tipo = 'receber' AND vencimento < CURRENT_DATE), 0) AS atrasado_receber
     FROM contas_lancamentos cl
     ${whereAberto}`,
    paramsAberto
  );

  const paramsPago: unknown[] = [];
  const condicoesPago: string[] = ["status = 'pago'"];
  if (filtro.lojaId !== undefined) {
    paramsPago.push(filtro.lojaId);
    condicoesPago.push(`loja_id = $${paramsPago.length}`);
  } else if (filtro.lojasPermitidas !== undefined) {
    paramsPago.push(filtro.lojasPermitidas);
    condicoesPago.push(`loja_id = ANY($${paramsPago.length}::int[])`);
  }
  if (filtro.dataInicio !== undefined) {
    paramsPago.push(filtro.dataInicio);
    condicoesPago.push(`data_pagamento >= $${paramsPago.length}`);
  }
  if (filtro.dataFim !== undefined) {
    paramsPago.push(filtro.dataFim);
    condicoesPago.push(`data_pagamento <= $${paramsPago.length}`);
  }

  const { rows: pagoRows } = await pool.query(
    `SELECT
       COALESCE(SUM(valor) FILTER (WHERE tipo = 'pagar'), 0) AS pago_periodo,
       COALESCE(SUM(valor) FILTER (WHERE tipo = 'receber'), 0) AS recebido_periodo
     FROM contas_lancamentos WHERE ${condicoesPago.join(" AND ")}`,
    paramsPago
  );

  const a = abertoRows[0];
  const p = pagoRows[0];
  const pagoPeriodo = Number(p.pago_periodo);
  const recebidoPeriodo = Number(p.recebido_periodo);
  return {
    emAbertoPagar: Number(a.em_aberto_pagar),
    emAbertoReceber: Number(a.em_aberto_receber),
    atrasadoPagar: Number(a.atrasado_pagar),
    atrasadoReceber: Number(a.atrasado_receber),
    pagoPeriodo,
    recebidoPeriodo,
    saldoPeriodo: recebidoPeriodo - pagoPeriodo,
  };
}
