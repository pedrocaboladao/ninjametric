import express from "express";
import { env } from "./config/env";
import { requireInternalKey } from "./middleware/requireInternalKey";
import { marketRouter } from "./routes/market";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Todo o resto exige a chave de serviço interna — nunca cookie, nunca
// sessão. Quem decide se um usuário do painel pode chegar até aqui é
// exclusivamente o ml-core (requireAuth + requirePermissao), que faz o
// proxy pra cá injetando essa chave.
app.use(requireInternalKey, marketRouter);

app.listen(env.port, () => {
  console.log(`Market Intelligence rodando em http://localhost:${env.port}`);
});
