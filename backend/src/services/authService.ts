import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export const COOKIE_NAME = "painel_sessao";

export function verificarLogin(username: string, password: string): boolean {
  if (username !== env.authUsername) return false;
  return bcrypt.compareSync(password, env.authPasswordHash);
}

export function gerarToken(username: string): string {
  return jwt.sign({ sub: username }, env.jwtSecret, { expiresIn: "30d" });
}

export function verificarToken(token: string): boolean {
  try {
    jwt.verify(token, env.jwtSecret);
    return true;
  } catch {
    return false;
  }
}
