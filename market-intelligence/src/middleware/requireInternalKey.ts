import { Request, Response, NextFunction } from "express";
import { env } from "../config/env";

// Não entende cookie nem JWT — só aceita a chave de serviço interna
// (INTERNAL_SERVICE_KEY), a mesma que o ml-core usa pra chamar aqui. Quem
// decide se um usuário pode acessar continua sendo só o ml-core (requireAuth
// + requirePermissao lá); este serviço só confia em quem já provou ser o
// ml-core.
export function requireInternalKey(req: Request, res: Response, next: NextFunction) {
  const chave = req.header("X-Internal-Key");
  if (!chave || chave !== env.internalServiceKey) {
    res.status(401).json({ error: "Chave interna inválida ou ausente." });
    return;
  }
  next();
}
