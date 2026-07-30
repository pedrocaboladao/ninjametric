import { pool } from "../db/pool";

export interface Empacotador {
  id: number;
  numero: number;
  nome: string;
  metaDiaria: number | null;
}

export async function listarEmpacotadores(): Promise<Empacotador[]> {
  const { rows } = await pool.query("SELECT id, numero, nome, meta_diaria FROM empacotadores ORDER BY numero");
  return rows.map((r) => ({ id: r.id, numero: r.numero, nome: r.nome, metaDiaria: r.meta_diaria }));
}

export async function criarEmpacotador(numero: number, nome: string): Promise<Empacotador> {
  const { rows } = await pool.query(
    "INSERT INTO empacotadores (numero, nome) VALUES ($1, $2) RETURNING id, numero, nome, meta_diaria",
    [numero, nome]
  );
  return { id: rows[0].id, numero: rows[0].numero, nome: rows[0].nome, metaDiaria: rows[0].meta_diaria };
}

export interface AtualizacaoEmpacotador {
  numero?: number;
  nome?: string;
  metaDiaria?: number | null;
}

export async function atualizarEmpacotador(id: number, dados: AtualizacaoEmpacotador): Promise<void> {
  const campos: string[] = [];
  const valores: unknown[] = [];
  let i = 1;

  if (dados.numero !== undefined) {
    campos.push(`numero = $${i++}`);
    valores.push(dados.numero);
  }
  if (dados.nome !== undefined) {
    campos.push(`nome = $${i++}`);
    valores.push(dados.nome);
  }
  if (dados.metaDiaria !== undefined) {
    campos.push(`meta_diaria = $${i++}`);
    valores.push(dados.metaDiaria);
  }

  if (campos.length === 0) return;
  valores.push(id);

  await pool.query(`UPDATE empacotadores SET ${campos.join(", ")} WHERE id = $${i}`, valores);
}

export async function excluirEmpacotador(id: number): Promise<void> {
  await pool.query("DELETE FROM empacotadores WHERE id = $1", [id]);
}

export interface LancamentoDia {
  empacotadorId: number;
  numero: number;
  nome: string;
  pacotes: number;
}

export async function obterLancamentosDoDia(data: string): Promise<LancamentoDia[]> {
  const { rows } = await pool.query(
    `SELECT e.id AS empacotador_id, e.numero, e.nome, COALESCE(p.pacotes, 0) AS pacotes
     FROM empacotadores e
     LEFT JOIN empacotadores_pacotes p ON p.empacotador_id = e.id AND p.data = $1
     ORDER BY e.numero`,
    [data]
  );
  return rows.map((r) => ({ empacotadorId: r.empacotador_id, numero: r.numero, nome: r.nome, pacotes: r.pacotes }));
}

export interface ItemLancamento {
  empacotadorId: number;
  pacotes: number;
}

export async function lancarPacotesDoDia(data: string, itens: ItemLancamento[]): Promise<void> {
  await Promise.all(
    itens.map((item) =>
      pool.query(
        `INSERT INTO empacotadores_pacotes (empacotador_id, data, pacotes)
         VALUES ($1, $2, $3)
         ON CONFLICT (empacotador_id, data) DO UPDATE SET pacotes = $3, atualizado_em = now()`,
        [item.empacotadorId, data, item.pacotes]
      )
    )
  );
}

export interface ItemRanking {
  id: number;
  numero: number;
  nome: string;
  totalPacotes: number;
}

export async function obterRankingMensal(ano: number, mes: number): Promise<ItemRanking[]> {
  const { rows } = await pool.query(
    `SELECT e.id, e.numero, e.nome, COALESCE(SUM(p.pacotes), 0)::int AS total
     FROM empacotadores e
     LEFT JOIN empacotadores_pacotes p ON p.empacotador_id = e.id
       AND EXTRACT(YEAR FROM p.data) = $1 AND EXTRACT(MONTH FROM p.data) = $2
     GROUP BY e.id
     ORDER BY total DESC, e.numero ASC`,
    [ano, mes]
  );
  return rows.map((r) => ({ id: r.id, numero: r.numero, nome: r.nome, totalPacotes: r.total }));
}

export interface HistoricoDia {
  data: string;
  pacotes: number;
}

export async function obterHistoricoEmpacotador(
  empacotadorId: number,
  ano: number,
  mes: number
): Promise<HistoricoDia[]> {
  const { rows } = await pool.query(
    `SELECT to_char(data, 'YYYY-MM-DD') AS data, pacotes
     FROM empacotadores_pacotes
     WHERE empacotador_id = $1 AND EXTRACT(YEAR FROM data) = $2 AND EXTRACT(MONTH FROM data) = $3
     ORDER BY data`,
    [empacotadorId, ano, mes]
  );
  return rows;
}
