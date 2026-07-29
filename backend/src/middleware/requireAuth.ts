import { Request, Response, NextFunction } from "express";
import { COOKIE_NAME, obterUsuarioAutenticado } from "../services/authService";
import type { UsuarioComPermissoes } from "../services/usuariosService";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: UsuarioComPermissoes;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  const usuario = token ? await obterUsuarioAutenticado(token) : null;
  if (!usuario) {
    res.status(401).json({ error: "Não autenticado." });
    return;
  }
  req.usuario = usuario;
  next();
}

export function requirePermissao(modulo: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const usuario = req.usuario;
    if (!usuario) {
      res.status(401).json({ error: "Não autenticado." });
      return;
    }
    if (!usuario.admin && !usuario.permissoes.includes(modulo)) {
      res.status(403).json({ error: "Você não tem permissão para acessar este módulo." });
      return;
    }
    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.usuario?.admin) {
    res.status(403).json({ error: "Apenas administradores podem acessar isso." });
    return;
  }
  next();
}
