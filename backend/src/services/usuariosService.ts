import bcrypt from "bcryptjs";
import { pool } from "../db/pool";

export const MODULOS_VALIDOS = ["dashboard", "perguntas", "clonar", "tarefas", "funcionarios"] as const;

export interface Usuario {
  id: number;
  username: string;
  nome: string;
  admin: boolean;
}

export interface UsuarioComPermissoes extends Usuario {
  permissoes: string[];
}

async function obterPermissoes(usuarioId: number): Promise<string[]> {
  const { rows } = await pool.query("SELECT modulo FROM usuarios_permissoes WHERE usuario_id = $1", [usuarioId]);
  return rows.map((r) => r.modulo);
}

export async function listarUsuarios(): Promise<UsuarioComPermissoes[]> {
  const { rows } = await pool.query("SELECT id, username, nome, admin FROM usuarios ORDER BY id");
  const usuarios: UsuarioComPermissoes[] = [];
  for (const u of rows) {
    usuarios.push({ ...u, permissoes: u.admin ? [] : await obterPermissoes(u.id) });
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
  const { rows } = await pool.query("SELECT id, username, nome, admin FROM usuarios WHERE id = $1", [id]);
  if (!rows[0]) return null;
  const permissoes = rows[0].admin ? [] : await obterPermissoes(id);
  return { ...rows[0], permissoes };
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

export async function criarUsuario(
  username: string,
  senha: string,
  nome: string,
  permissoes: string[]
): Promise<UsuarioComPermissoes> {
  const senhaHash = bcrypt.hashSync(senha, 10);
  const { rows } = await pool.query(
    "INSERT INTO usuarios (username, senha_hash, nome, admin) VALUES ($1, $2, $3, false) RETURNING id, username, nome, admin",
    [username, senhaHash, nome]
  );
  const usuario = rows[0];
  await definirPermissoes(usuario.id, permissoes);
  return { ...usuario, permissoes };
}

export interface AtualizacaoUsuario {
  nome?: string;
  senha?: string;
  permissoes?: string[];
}

export async function atualizarUsuario(id: number, dados: AtualizacaoUsuario): Promise<void> {
  if (dados.nome !== undefined) {
    await pool.query("UPDATE usuarios SET nome = $1 WHERE id = $2", [dados.nome, id]);
  }
  if (dados.senha !== undefined) {
    const senhaHash = bcrypt.hashSync(dados.senha, 10);
    await pool.query("UPDATE usuarios SET senha_hash = $1 WHERE id = $2", [senhaHash, id]);
  }
  if (dados.permissoes !== undefined) {
    await definirPermissoes(id, dados.permissoes);
  }
}

export async function excluirUsuario(id: number): Promise<void> {
  const { rows } = await pool.query("SELECT admin FROM usuarios WHERE id = $1", [id]);
  if (rows[0]?.admin) {
    throw new Error('Não é possível excluir uma conta administradora.');
  }
  await pool.query("DELETE FROM usuarios WHERE id = $1", [id]);
}
