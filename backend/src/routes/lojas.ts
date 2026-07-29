import { Router } from "express";
import { listLojas } from "../services/tokenStore";
import { temAcessoLoja } from "../services/usuariosService";
import { requireAdmin } from "../middleware/requireAuth";

export const lojasRouter = Router();

lojasRouter.get("/", async (req, res) => {
  try {
    const usuario = req.usuario!;
    const lojas = (await listLojas()).filter(
      (l) => l.ml_user_id !== null && temAcessoLoja(usuario, l.id)
    );
    res.json({ lojas: lojas.map((l) => ({ id: l.id, nome: l.nome })) });
  } catch (err) {
    console.error("Erro ao listar lojas:", err);
    res.status(500).json({ error: "Falha ao listar lojas." });
  }
});

// Lista todas as lojas cadastradas, incluindo as que ainda não autorizaram o
// Mercado Livre — usado para descobrir o id de uma loja recém-criada e montar
// o link de autorização (/auth/:lojaId/authorize), e para o gerenciador de
// usuários escolher quais lojas cada pessoa pode acessar.
lojasRouter.get("/todas", requireAdmin, async (_req, res) => {
  try {
    const lojas = await listLojas();
    res.json({ lojas: lojas.map((l) => ({ id: l.id, nome: l.nome, autorizada: l.ml_user_id !== null })) });
  } catch (err) {
    console.error("Erro ao listar lojas:", err);
    res.status(500).json({ error: "Falha ao listar lojas." });
  }
});
