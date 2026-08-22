import { pool } from "../db/pool";

// Fornecedor da Fábrica Distribuidora.
//
// O nome era texto digitado em cada conta, e o estrago apareceu na primeira
// carga: "METALLOG" e "MATALLOG BRASIL" são a mesma empresa, "ATACADAO DO EPI"
// e "ATACADAO DO EPI0" também. Cada dedo trocado vira um fornecedor novo no
// relatório e o total por fornecedor para de fechar.
//
// A conta continua guardando o nome como texto em `contraparte`: as que já
// existem seguem valendo, e o cadastro passa a ser a fonte da busca — o nome
// sai daqui, sempre igual.

export interface Fornecedor {
  id: number;
  nome: string;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  cidade: string | null;
  uf: string | null;
  categoriaPadrao: string | null;
  observacao: string | null;
  ativo: boolean;
  // quantas contas já foram lançadas com este nome — mostra quem é grande
  contas: number;
  total: number;
}

export interface FornecedorEntrada {
  nome: string;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  cidade: string | null;
  uf: string | null;
  categoriaPadrao: string | null;
  observacao: string | null;
  ativo: boolean;
}

interface Linha {
  id: number;
  nome: string;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  cidade: string | null;
  uf: string | null;
  categoria_padrao: string | null;
  observacao: string | null;
  ativo: boolean;
  contas: string;
  total: string;
}

function montar(r: Linha): Fornecedor {
  return {
    id: r.id,
    nome: r.nome,
    cnpj: r.cnpj,
    email: r.email,
    telefone: r.telefone,
    cidade: r.cidade,
    uf: r.uf,
    categoriaPadrao: r.categoria_padrao,
    observacao: r.observacao,
    ativo: r.ativo,
    contas: Number(r.contas),
    total: Number(r.total),
  };
}

export async function listarFornecedores(): Promise<Fornecedor[]> {
  const { rows } = await pool.query<Linha>(
    `SELECT f.id, f.nome, f.cnpj, f.email, f.telefone, f.cidade, f.uf,
            f.categoria_padrao, f.observacao, f.ativo,
            COALESCE(c.n, 0)     AS contas,
            COALESCE(c.total, 0) AS total
     FROM fabrica_fornecedores f
     LEFT JOIN (
       SELECT contraparte, COUNT(*) AS n, SUM(valor) AS total
       FROM fabrica_contas
       WHERE tipo = 'pagar' AND status <> 'cancelado'
       GROUP BY contraparte
     ) c ON c.contraparte = f.nome
     ORDER BY f.nome`
  );
  return rows.map(montar);
}

// Fornecedores que aparecem nas contas mas não estão cadastrados. É a lista de
// trabalho pra popular o cadastro sem digitar tudo de novo.
export async function fornecedoresNaoCadastrados(): Promise<
  { nome: string; contas: number; total: number; categoria: string | null }[]
> {
  const { rows } = await pool.query<{
    nome: string;
    contas: string;
    total: string;
    categoria: string | null;
  }>(
    `SELECT c.contraparte AS nome, COUNT(*) AS contas, SUM(c.valor) AS total,
            -- a categoria mais usada com este fornecedor vira a sugestão
            (SELECT c2.categoria FROM fabrica_contas c2
              WHERE c2.contraparte = c.contraparte AND c2.categoria IS NOT NULL
              GROUP BY c2.categoria ORDER BY COUNT(*) DESC LIMIT 1) AS categoria
     FROM fabrica_contas c
     WHERE c.tipo = 'pagar' AND c.contraparte IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM fabrica_fornecedores f WHERE f.nome = c.contraparte)
     GROUP BY c.contraparte
     ORDER BY SUM(c.valor) DESC`
  );
  return rows.map((r) => ({
    nome: r.nome,
    contas: Number(r.contas),
    total: Number(r.total),
    categoria: r.categoria,
  }));
}

function valores(e: FornecedorEntrada) {
  return [
    e.nome,
    e.cnpj,
    e.email,
    e.telefone,
    e.cidade,
    e.uf,
    e.categoriaPadrao,
    e.observacao,
    e.ativo,
  ];
}

export async function criarFornecedor(e: FornecedorEntrada): Promise<{ id: number }> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO fabrica_fornecedores
       (nome, cnpj, email, telefone, cidade, uf, categoria_padrao, observacao, ativo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    valores(e)
  );
  return { id: rows[0].id };
}

export async function atualizarFornecedor(id: number, e: FornecedorEntrada): Promise<void> {
  // renomear o fornecedor renomeia junto as contas dele: o nome na conta é
  // texto, e deixá-lo para trás criaria o fornecedor duplicado que este
  // cadastro existe pra evitar
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    const { rows } = await cliente.query<{ nome: string }>(
      "SELECT nome FROM fabrica_fornecedores WHERE id = $1",
      [id]
    );
    const antigo = rows[0]?.nome;
    await cliente.query(
      `UPDATE fabrica_fornecedores
       SET nome = $2, cnpj = $3, email = $4, telefone = $5, cidade = $6, uf = $7,
           categoria_padrao = $8, observacao = $9, ativo = $10
       WHERE id = $1`,
      [id, ...valores(e)]
    );
    if (antigo && antigo !== e.nome) {
      await cliente.query(
        "UPDATE fabrica_contas SET contraparte = $2 WHERE contraparte = $1",
        [antigo, e.nome]
      );
    }
    await cliente.query("COMMIT");
  } catch (err) {
    await cliente.query("ROLLBACK");
    throw err;
  } finally {
    cliente.release();
  }
}

export async function excluirFornecedor(id: number): Promise<void> {
  // as contas não somem junto: elas guardam o nome, não o id
  await pool.query("DELETE FROM fabrica_fornecedores WHERE id = $1", [id]);
}
