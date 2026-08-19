import { Router } from "express";
import { env } from "../config/env";
import { listarVendasFinanceiras } from "../services/financeiroService";
import { listLojas, type Loja } from "../services/tokenStore";
import { janelaUltimosDias } from "../services/dateUtils";

// Rota serviço-a-serviço, sem requireAuth (não é chamada pelo navegador) —
// protegida só pela chave de serviço interna. Só devolve item_id/seller_id
// (= ml_user_id, público)/nome da loja de TODAS as lojas do grupo com
// integração ML ativa (pra dar market share do grupo inteiro, não só das 4
// lojas pessoais) — nunca token, nunca sessão. Ver
// backend/src/routes/internal.ts no plano de isolamento do Market
// Intelligence.
export const internalRouter = Router();

const TAMANHO_LOTE = 5;

function emLotes<T>(itens: T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    lotes.push(itens.slice(i, i + tamanho));
  }
  return lotes;
}

internalRouter.get("/public-ml-items", async (req, res) => {
  const chave = req.header("X-Internal-Key");
  if (!env.internalServiceKey || chave !== env.internalServiceKey) {
    res.status(401).json({ error: "Chave interna inválida ou ausente." });
    return;
  }

  const itens = new Map<string, { item_id: string; seller_id: string; store_name: string }>();

  // Best-effort — isso é só um "bônus" (marcar "sua loja" no resultado da
  // busca de mercado), nunca pode travar/derrubar a chamada. Se der erro em
  // qualquer parte (token expirado numa loja, instabilidade da API do ML),
  // loga e devolve o que já tiver coletado até ali, em vez de deixar a
  // conexão pendurada sem resposta.
  try {
    const lojas = await listLojas();
    const lojasComMl = lojas.filter((l) => l.ml_user_id !== null);
    const { inicioDia, agora } = janelaUltimosDias(90);

    async function coletarLoja(loja: Loja): Promise<void> {
      try {
        const { vendas } = await listarVendasFinanceiras(loja.id, undefined, inicioDia, agora);
        for (const venda of vendas) {
          if (!itens.has(venda.itemId)) {
            itens.set(venda.itemId, {
              item_id: venda.itemId,
              seller_id: String(loja.ml_user_id),
              store_name: loja.nome,
            });
          }
        }
      } catch (err) {
        console.error(`/internal/public-ml-items: falha ao buscar vendas da loja ${loja.id}:`, err);
      }
    }

    // Em lotes paralelos (não uma loja de cada vez) — com ~20 lojas,
    // sequencial ficaria lento demais; listarVendasFinanceiras já tem cache
    // de 15min, então lotes concorrentes não sobrecarregam a API do ML à toa.
    for (const lote of emLotes(lojasComMl, TAMANHO_LOTE)) {
      await Promise.all(lote.map(coletarLoja));
    }
  } catch (err) {
    console.error("/internal/public-ml-items: falha inesperada:", err);
  }

  res.json([...itens.values()]);
});
