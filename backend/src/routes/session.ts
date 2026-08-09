import { Router } from "express";
import rateLimit from "express-rate-limit";
import { COOKIE_NAME, verificarLogin, gerarToken, obterUsuarioAutenticado } from "../services/authService";

export const sessionRouter = Router();

// Trava força bruta de senha — por USUÁRIO tentado, não por IP. O painel
// fica atrás do Nginx do host sem X-Forwarded-For configurado (ver
// DEPLOY.md), então req.ip sempre seria o IP do proxy pra toda requisição;
// por usuário evita esse problema E evita que várias pessoas atrás do mesmo
// IP (ex: mesma loja) travem umas às outras.
const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const username = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
    return username || "sem-usuario";
  },
  message: { error: "Muitas tentativas de login. Aguarde alguns minutos e tente de novo." },
});

const COOKIE_OPCOES = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

sessionRouter.post("/login", limitadorLogin, async (req, res) => {
  const { username, password } = req.body;
  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Informe usuário e senha." });
    return;
  }

  const usuario = await verificarLogin(username, password);
  if (!usuario) {
    res.status(401).json({ error: "Usuário ou senha inválidos." });
    return;
  }

  const token = gerarToken(usuario.id);
  res.cookie(COOKIE_NAME, token, COOKIE_OPCOES);
  res.json({ ok: true });
});

sessionRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

sessionRouter.get("/me", async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  const usuario = token ? await obterUsuarioAutenticado(token) : null;
  res.json({ autenticado: Boolean(usuario), usuario });
});
