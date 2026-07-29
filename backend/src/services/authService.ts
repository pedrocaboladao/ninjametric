import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { buscarUsuarioPorUsername, buscarUsuarioComPermissoes, UsuarioComPermissoes } from "./usuariosService";

export const COOKIE_NAME = "painel_sessao";

export async function verificarLogin(username: string, password: string): Promise<UsuarioComPermissoes | null> {
  const usuario = await buscarUsuarioPorUsername(username);
  if (!usuario) return null;
  if (!bcrypt.compareSync(password, usuario.senhaHash)) return null;
  return buscarUsuarioComPermissoes(usuario.id);
}

export function gerarToken(usuarioId: number): string {
  return jwt.sign({ sub: usuarioId }, env.jwtSecret, { expiresIn: "30d" });
}

export async function obterUsuarioAutenticado(token: string): Promise<UsuarioComPermissoes | null> {
  try {
    const payload = jwt.verify(token, env.jwtSecret) as { sub: number };
    return await buscarUsuarioComPermissoes(payload.sub);
  } catch {
    return null;
  }
}
