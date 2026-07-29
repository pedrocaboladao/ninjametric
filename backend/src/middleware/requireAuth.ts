import { Request, Response, NextFunction } from "express";
import { COOKIE_NAME, verificarToken } from "../services/authService";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token || !verificarToken(token)) {
    res.status(401).json({ error: "Não autenticado." });
    return;
  }
  next();
}
