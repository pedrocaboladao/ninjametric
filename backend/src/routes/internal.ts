import { Router } from "express";
import { env } from "../config/env";
import { listarVendasFinanceiras } from "../services/financeiroService";
import { LOJAS_AGENTE } from "../services/agenteAdsService";
import { listLojas } from "../services/tokenStore";
import { janelaUltimosDias } from "../services/dateUtils";

// Rota serviço-a-serviço, sem requireAuth (não é chamada pelo navegador) —
// protegida só pela chave de serviço interna. Só devolve item_id/seller_id
// (= ml_user_id, público)/nome da loja das LOJAS_AGENTE — nunca token,
// nunca dado de outras lojas do grupo. Ver backend/src/routes/internal.ts
// no plano de isolamento do Market Intelligence.
export const internalRouter = Router();

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
    const lojasProprias = new Map(lojas.filter((l) => LOJAS_AGENTE.includes(l.id)).map((l) => [l.id, l]));
    const { inicioDia, agora } = janelaUltimosDias(90);

    for (const lojaId of LOJAS_AGENTE) {
      const loja = lojasProprias.get(lojaId);
      if (!loja || loja.ml_user_id === null) continue;

      try {
        const { vendas } = await listarVendasFinanceiras(lojaId, LOJAS_AGENTE, inicioDia, agora);
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
        console.error(`/internal/public-ml-items: falha ao buscar vendas da loja ${lojaId}:`, err);
      }
    }
  } catch (err) {
    console.error("/internal/public-ml-items: falha inesperada:", err);
  }

  res.json([...itens.values()]);
});
