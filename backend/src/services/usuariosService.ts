import bcrypt from "bcryptjs";
import { pool } from "../db/pool";

export const MODULOS_VALIDOS = [
  "dashboard",
  "perguntas",
  "clonar",
  "tarefas",
  "funcionarios",
  "produtos",
  "financeiro",
  "ads",
  "contas",
  "dre",
  "correcoes",
  "fabricacao",
  "ean",
  "promocoes",
  "pesquisa",
  "market_intelligence",
  "fabrica_produtos",
  "fabrica_clientes",
  "fabrica_embalagens",
  "fabrica_estoque",
  "fabrica_pedidos",
] as const;

export interface Usuario {
  id: number;
  username: string;
  nome: string;
  admin: boolean;
}

export interface UsuarioComPermissoes extends Usuario {
  permissoes: string[];
  lojas: number[];
  todasLojas: boolean;
  clonarTodasLojas: boolean;
}

export function temAcessoLoja(
  usuario: { admin: boolean; todasLojas: boolean; lojas: number[] },
  lojaId: number
): boolean {
  return usuario.admin || usuario.todasLojas || usuario.lojas.includes(lojaId);
}

export function lojasEfetivas(usuario: {
  admin: boolean;
  todasLojas: boolean;
  lojas: number[];
}): number[] | undefined {
  return usuario.admin || usuario.todasLojas ? undefined : usuario.lojas;
}

// Igual a temAcessoLoja/lojasEfetivas, mas considera também o atalho
// "clonarTodasLojas", que libera o Clonar Anúncio para todas as lojas mesmo
// que a lista normal de "lojas com acesso" seja mais restrita.
export function temAcessoLojaParaClonagem(
  usuario: { admin: boolean; todasLojas: boolean; clonarTodasLojas: boolean; lojas: number[] },
  lojaId: number
): boolean {
  return usuario.admin || usuario.todasLojas || usuario.clonarTodasLojas || usuario.lojas.includes(lojaId);
}

export function lojasEfetivasParaClonagem(usuario: {
  admin: boolean;
  todasLojas: boolean;
  clonarTodasLojas: boolean;
  lojas: number[];
}): number[] | undefined {
  return usuario.admin || usuario.todasLojas || usuario.clonarTodasLojas ? undefined : usuario.lojas;
}

async function obterPermissoes(usuarioId: number): Promise<string[]> {
  const { rows } = await pool.query("SELECT modulo FROM usuarios_permissoes WHERE usuario_id = $1", [usuarioId]);
  return rows.map((r) => r.modulo);
}

async function obterLojasPermitidas(usuarioId: number): Promise<number[]> {
  const { rows } = await pool.query("SELECT loja_id FROM usuarios_lojas WHERE usuario_id = $1", [usuarioId]);
  return rows.map((r) => r.loja_id);
}

export async function listarUsuarios(): Promise<UsuarioComPermissoes[]> {
  const { rows } = await pool.query(
    "SELECT id, username, nome, admin, todas_lojas, clonar_todas_lojas FROM usuarios ORDER BY id"
  );
  const usuarios: UsuarioComPermissoes[] = [];
  for (const u of rows) {
    usuarios.push({
      id: u.id,
      username: u.username,
      nome: u.nome,
      admin: u.admin,
      todasLojas: u.todas_lojas,
      clonarTodasLojas: u.clonar_todas_lojas,
      permissoes: u.admin ? [] : await obterPermissoes(u.id),
      lojas: await obterLojasPermitidas(u.id),
    });
  }
  return usuarios;
}

export async function buscarUsuarioPorUsername(
  username: string
): Promise<(Usuario & { senhaHash: string }) | null> {
  const { rows } = await pool.query(
    "SELECT id, username, nome, admin, senha_hash AS senha_hash FROM usuarios WHERE username = $1",
    [username]
  );
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    username: rows[0].username,
    nome: rows[0].nome,
    admin: rows[0].admin,
    senhaHash: rows[0].senha_hash,
  };
}

export async function buscarUsuarioComPermissoes(id: number): Promise<UsuarioComPermissoes | null> {
  const { rows } = await pool.query(
    "SELECT id, username, nome, admin, todas_lojas, clonar_todas_lojas FROM usuarios WHERE id = $1",
    [id]
  );
  if (!rows[0]) return null;
  const admin = rows[0].admin;
  const permissoes = admin ? [] : await obterPermissoes(id);
  const lojas = await obterLojasPermitidas(id);
  return {
    id: rows[0].id,
    username: rows[0].username,
    nome: rows[0].nome,
    admin,
    todasLojas: rows[0].todas_lojas,
    clonarTodasLojas: rows[0].clonar_todas_lojas,
    permissoes,
    lojas,
  };
}

export async function definirPermissoes(usuarioId: number, permissoes: string[]): Promise<void> {
  await pool.query("DELETE FROM usuarios_permissoes WHERE usuario_id = $1", [usuarioId]);
  for (const modulo of permissoes) {
    await pool.query(
      "INSERT INTO usuarios_permissoes (usuario_id, modulo) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [usuarioId, modulo]
    );
  }
}

export async function definirLojas(usuarioId: number, lojaIds: number[]): Promise<void> {
  await pool.query("DELETE FROM usuarios_lojas WHERE usuario_id = $1", [usuarioId]);
  for (const lojaId of lojaIds) {
    await pool.query("INSERT INTO usuarios_lojas (usuario_id, loja_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
      usuarioId,
      lojaId,
    ]);
  }
}

export async function criarUsuario(
  username: string,
  senha: string,
  nome: string,
  permissoes: string[],
  lojas: number[],
  todasLojas: boolean,
  clonarTodasLojas: boolean
): Promise<UsuarioComPermissoes> {
  const senhaHash = bcrypt.hashSync(senha, 10);
  const { rows } = await pool.query(
    `INSERT INTO usuarios (username, senha_hash, nome, admin, todas_lojas, clonar_todas_lojas)
     VALUES ($1, $2, $3, false, $4, $5)
     RETURNING id, username, nome, admin, todas_lojas, clonar_todas_lojas`,
    [username, senhaHash, nome, todasLojas, clonarTodasLojas]
  );
  const usuario = rows[0];
  await definirPermissoes(usuario.id, permissoes);
  await definirLojas(usuario.id, lojas);
  return {
    id: usuario.id,
    username: usuario.username,
    nome: usuario.nome,
    admin: usuario.admin,
    todasLojas: usuario.todas_lojas,
    clonarTodasLojas: usuario.clonar_todas_lojas,
    permissoes,
    lojas,
  };
}

export interface AtualizacaoUsuario {
  nome?: string;
  senha?: string;
  permissoes?: string[];
  lojas?: number[];
  todasLojas?: boolean;
  clonarTodasLojas?: boolean;
}

export async function atualizarUsuario(id: number, dados: AtualizacaoUsuario): Promise<void> {
  if (dados.nome !== undefined) {
    await pool.query("UPDATE usuarios SET nome = $1 WHERE id = $2", [dados.nome, id]);
  }
  if (dados.senha !== undefined) {
    const senhaHash = bcrypt.hashSync(dados.senha, 10);
    await pool.query("UPDATE usuarios SET senha_hash = $1 WHERE id = $2", [senhaHash, id]);
  }
  if (dados.todasLojas !== undefined) {
    await pool.query("UPDATE usuarios SET todas_lojas = $1 WHERE id = $2", [dados.todasLojas, id]);
  }
  if (dados.clonarTodasLojas !== undefined) {
    await pool.query("UPDATE usuarios SET clonar_todas_lojas = $1 WHERE id = $2", [dados.clonarTodasLojas, id]);
  }
  if (dados.permissoes !== undefined) {
    await definirPermissoes(id, dados.permissoes);
  }
  if (dados.lojas !== undefined) {
    await definirLojas(id, dados.lojas);
  }
}

export async function excluirUsuario(id: number): Promise<void> {
  const { rows } = await pool.query("SELECT admin FROM usuarios WHERE id = $1", [id]);
  if (rows[0]?.admin) {
    throw new Error('Não é possível excluir uma conta administradora.');
  }
  await pool.query("DELETE FROM usuarios WHERE id = $1", [id]);
}
