import { Router } from "express";
import { COOKIE_NAME, verificarLogin, gerarToken, verificarToken } from "../services/authService";

export const sessionRouter = Router();

const COOKIE_OPCOES = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

sessionRouter.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Informe usuário e senha." });
    return;
  }

  if (!verificarLogin(username, password)) {
    res.status(401).json({ error: "Usuário ou senha inválidos." });
    return;
  }

  const token = gerarToken(username);
  res.cookie(COOKIE_NAME, token, COOKIE_OPCOES);
  res.json({ ok: true });
});

sessionRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

sessionRouter.get("/me", (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  const autenticado = Boolean(token && verificarToken(token));
  res.json({ autenticado });
});
