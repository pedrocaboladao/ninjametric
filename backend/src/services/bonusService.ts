import { pool } from "../db/pool";

const VALOR_POR_PACOTE_EXCEDENTE = 0.5;

export interface ResumoBonus {
  empacotadorId: number;
  numero: number;
  nome: string;
  metaDiaria: number | null;
  totalPacotes: number;
  bonusGerado: number;
  bonusPago: number;
  bonusPendente: number;
}

async function calcularBonusGerado(empacotadorId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(GREATEST(p.pacotes - e.meta_diaria, 0)), 0)::numeric AS excedente
     FROM empacotadores_pacotes p
     JOIN empacotadores e ON e.id = p.empacotador_id
     WHERE p.empacotador_id = $1 AND e.meta_diaria IS NOT NULL`,
    [empacotadorId]
  );
  return Number(rows[0].excedente) * VALOR_POR_PACOTE_EXCEDENTE;
}

async function calcularBonusPago(empacotadorId: number): Promise<number> {
  const { rows } = await pool.query(
    "SELECT COALESCE(SUM(valor), 0)::numeric AS pago FROM empacotadores_bonus_pagamentos WHERE empacotador_id = $1",
    [empacotadorId]
  );
  return Number(rows[0].pago);
}

export async function listarResumoBonus(): Promise<ResumoBonus[]> {
  const { rows: empacotadores } = await pool.query(
    `SELECT e.id, e.numero, e.nome, e.meta_diaria, COALESCE(SUM(p.pacotes), 0)::int AS total_pacotes
     FROM empacotadores e
     LEFT JOIN empacotadores_pacotes p ON p.empacotador_id = e.id
     GROUP BY e.id
     ORDER BY e.numero`
  );

  const resumo: ResumoBonus[] = [];
  for (const e of empacotadores) {
    const gerado = await calcularBonusGerado(e.id);
    const pago = await calcularBonusPago(e.id);
    resumo.push({
      empacotadorId: e.id,
      numero: e.numero,
      nome: e.nome,
      metaDiaria: e.meta_diaria,
      totalPacotes: e.total_pacotes,
      bonusGerado: gerado,
      bonusPago: pago,
      bonusPendente: Math.round((gerado - pago) * 100) / 100,
    });
  }
  return resumo;
}

export interface DetalheDiaBonus {
  data: string;
  pacotes: number;
  meta: number | null;
  excedente: number;
  bonusDoDia: number;
}

export async function obterDetalheDiarioBonus(empacotadorId: number): Promise<DetalheDiaBonus[]> {
  const { rows } = await pool.query(
    `SELECT to_char(p.data, 'YYYY-MM-DD') AS data, p.pacotes, e.meta_diaria
     FROM empacotadores_pacotes p
     JOIN empacotadores e ON e.id = p.empacotador_id
     WHERE p.empacotador_id = $1
     ORDER BY p.data`,
    [empacotadorId]
  );
  return rows.map((r) => {
    const meta = r.meta_diaria as number | null;
    const excedente = meta !== null ? Math.max(r.pacotes - meta, 0) : 0;
    return {
      data: r.data,
      pacotes: r.pacotes,
      meta,
      excedente,
      bonusDoDia: excedente * VALOR_POR_PACOTE_EXCEDENTE,
    };
  });
}

export async function registrarPagamentoAvulso(empacotadorId: number, valor: number): Promise<void> {
  await pool.query(
    "INSERT INTO empacotadores_bonus_pagamentos (empacotador_id, valor, origem) VALUES ($1, $2, 'avulso')",
    [empacotadorId, valor]
  );
}

export interface ItemFechamento {
  empacotadorId: number;
  numero: number;
  nome: string;
  valor: number;
}

export interface Fechamento {
  id: number;
  criadoEm: string;
  total: number;
  itens: ItemFechamento[];
}

export async function fecharBonusEmLote(): Promise<Fechamento> {
  const resumo = await listarResumoBonus();
  const pendentes = resumo.filter((r) => r.bonusPendente > 0);

  const { rows: fechamentoRows } = await pool.query(
    "INSERT INTO empacotadores_bonus_fechamentos DEFAULT VALUES RETURNING id, to_char(criado_em, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS criado_em"
  );
  const fechamentoId = fechamentoRows[0].id;

  const itens: ItemFechamento[] = [];
  for (const p of pendentes) {
    await pool.query(
      "INSERT INTO empacotadores_bonus_pagamentos (empacotador_id, valor, origem, fechamento_id) VALUES ($1, $2, 'fechamento', $3)",
      [p.empacotadorId, p.bonusPendente, fechamentoId]
    );
    itens.push({ empacotadorId: p.empacotadorId, numero: p.numero, nome: p.nome, valor: p.bonusPendente });
  }

  return {
    id: fechamentoId,
    criadoEm: fechamentoRows[0].criado_em,
    total: Math.round(itens.reduce((s, i) => s + i.valor, 0) * 100) / 100,
    itens,
  };
}

export async function listarFechamentos(): Promise<Fechamento[]> {
  const { rows: fechamentos } = await pool.query(
    `SELECT id, to_char(criado_em, 'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em
     FROM empacotadores_bonus_fechamentos
     ORDER BY criado_em DESC`
  );

  const resultado: Fechamento[] = [];
  for (const f of fechamentos) {
    const { rows: itensRows } = await pool.query(
      `SELECT bp.empacotador_id, e.numero, e.nome, bp.valor
       FROM empacotadores_bonus_pagamentos bp
       JOIN empacotadores e ON e.id = bp.empacotador_id
       WHERE bp.fechamento_id = $1
       ORDER BY e.numero`,
      [f.id]
    );
    const itens = itensRows.map((r) => ({
      empacotadorId: r.empacotador_id,
      numero: r.numero,
      nome: r.nome,
      valor: Number(r.valor),
    }));
    resultado.push({
      id: f.id,
      criadoEm: f.criado_em,
      total: Math.round(itens.reduce((s, i) => s + i.valor, 0) * 100) / 100,
      itens,
    });
  }
  return resultado;
}
