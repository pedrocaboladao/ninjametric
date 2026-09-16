import { Router } from "express";
import crypto from "crypto";
import { buildAuthorizationUrl, exchangeCodeForToken } from "../services/mercadoLivreAuth";
import { saveTokens } from "../services/tokenStore";
import { generatePkcePair, guardarCodeVerifier, consumirCodeVerifier } from "../services/pkce";
import { pool } from "../db/pool";
import { configurado as shopeeConfigurado, urlDeAutorizacao as urlAutorizacaoShopee } from "../services/shopeeAuth";

export const authRouter = Router();

// Inicia a autorização OAuth2 para uma loja específica.
// Uso: GET /auth/:lojaId/authorize
authRouter.get("/:lojaId/authorize", (req, res) => {
  const lojaId = req.params.lojaId;
  const state = `${lojaId}:${crypto.randomBytes(8).toString("hex")}`;
  const { codeVerifier, codeChallenge } = generatePkcePair();
  guardarCodeVerifier(state, codeVerifier);
  const url = buildAuthorizationUrl(state, codeChallenge);
  res.redirect(url);
});

// Equivalente ao de cima, pra Shopee — não tinha link compartilhável até
// agora: a rota /api/shopee/:lojaId/autorizar (routes/shopee.ts) devolve
// JSON e exige sessão de admin (pensada pra um botão dentro do painel, que
// nunca chegou a ser construído). Fica aqui, pública, no mesmo espírito do
// /:lojaId/authorize acima — a assinatura HMAC é calculada na hora do
// clique (urlDeAutorizacao usa o timestamp atual), então o link não expira
// por ficar parado.
authRouter.get("/shopee/:lojaId/authorize", (req, res) => {
  const lojaId = Number(req.params.lojaId);
  if (!Number.isInteger(lojaId)) {
    res.status(400).send("Id de loja inválido.");
    return;
  }
  if (!shopeeConfigurado()) {
    res.status(400).send("SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY não configurados no servidor.");
    return;
  }
  res.redirect(urlAutorizacaoShopee(lojaId));
});

// Callback do Mercado Livre após o usuário autorizar o app.
authRouter.get("/callback", async (req, res) => {
  const { code, state } = req.query;
  if (typeof code !== "string" || typeof state !== "string") {
    res.status(400).json({ error: "Parâmetros code/state ausentes." });
    return;
  }

  const lojaId = Number(state.split(":")[0]);
  const codeVerifier = consumirCodeVerifier(state);
  if (!Number.isInteger(lojaId) || !codeVerifier) {
    res.status(400).json({ error: "state inválido ou expirado. Tente autorizar novamente." });
    return;
  }

  try {
    const token = await exchangeCodeForToken(code, codeVerifier);

    const { rows } = await pool.query<{ id: number; nome: string }>(
      "SELECT id, nome FROM lojas WHERE ml_user_id = $1",
      [token.user_id]
    );
    const lojaComEsseUsuario = rows[0];
    if (lojaComEsseUsuario && lojaComEsseUsuario.id !== lojaId) {
      res.status(409).send(
        `Essa conta do Mercado Livre já está associada à loja "${lojaComEsseUsuario.nome}". ` +
          `Você tentou autorizá-la para outra loja (id ${lojaId}) — provavelmente usou o link ` +
          `errado ou logou com a conta errada. Nada foi salvo; confira o link e tente de novo.`
      );
      return;
    }

    await pool.query("UPDATE lojas SET ml_user_id = $1 WHERE id = $2", [token.user_id, lojaId]);
    await saveTokens(lojaId, token);
    res.send("Conta do Mercado Livre autorizada com sucesso. Pode fechar esta aba.");
  } catch (err) {
    console.error("Erro ao trocar code por token:", err);
    res.status(500).json({ error: "Falha ao autorizar conta." });
  }
});
