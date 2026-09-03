import { Router } from "express";
import { listLojas, atualizarImpostoLoja, atualizarCustoFixoLoja } from "../services/tokenStore";
import { pool } from "../db/pool";
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

// Mesma ideia do "/" acima, mas pro seletor de loja das telas da Shopee
// (Financeiro Shopee etc.) — "/" filtra por ml_user_id, então uma loja só-
// Shopee (ex: Catedral Ferramentas, sem Mercado Livre) nunca aparecia lá.
// Achado real: o filtro ficava vazio pra essas lojas mesmo com a Shopee já
// autorizada e os dados existindo no backend.
lojasRouter.get("/shopee", async (req, res) => {
  try {
    const usuario = req.usuario!;
    const { rows } = await pool.query<{ id: number; nome: string }>(
      `SELECT l.id, l.nome FROM lojas l
       INNER JOIN contas_shopee c ON c.loja_id = l.id
       ORDER BY l.id`
    );
    const lojas = rows.filter((l) => temAcessoLoja(usuario, l.id));
    res.json({ lojas });
  } catch (err) {
    console.error("Erro ao listar lojas da Shopee:", err);
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
    res.json({
      lojas: lojas.map((l) => ({
        id: l.id,
        nome: l.nome,
        autorizada: l.ml_user_id !== null,
        impostoPercentual: l.imposto_percentual,
        custoFixoMensal: l.custo_fixo_mensal,
      })),
    });
  } catch (err) {
    console.error("Erro ao listar lojas:", err);
    res.status(500).json({ error: "Falha ao listar lojas." });
  }
});

// Alíquota de imposto usada no cálculo de margem no Financeiro — editável
// por loja, só admin.
lojasRouter.put("/:id/imposto", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { impostoPercentual } = req.body;
  if (!Number.isInteger(id) || typeof impostoPercentual !== "number" || impostoPercentual < 0 || impostoPercentual > 100) {
    res.status(400).json({ error: "Informe um percentual de imposto entre 0 e 100." });
    return;
  }

  try {
    await atualizarImpostoLoja(id, impostoPercentual);
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao atualizar imposto da loja:", err);
    res.status(500).json({ error: "Falha ao atualizar imposto." });
  }
});

// Custo fixo mensal (aluguel, salários etc.) dessa loja — usado no ponto de
// equilíbrio do Financeiro. Editável por loja, só admin.
lojasRouter.put("/:id/custo-fixo", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { custoFixoMensal } = req.body;
  if (!Number.isInteger(id) || typeof custoFixoMensal !== "number" || custoFixoMensal < 0) {
    res.status(400).json({ error: "Informe um valor de custo fixo válido." });
    return;
  }

  try {
    await atualizarCustoFixoLoja(id, custoFixoMensal);
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao atualizar custo fixo da loja:", err);
    res.status(500).json({ error: "Falha ao atualizar custo fixo." });
  }
});
