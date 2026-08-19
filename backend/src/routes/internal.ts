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

  const lojas = await listLojas();
  const lojasProprias = new Map(lojas.filter((l) => LOJAS_AGENTE.includes(l.id)).map((l) => [l.id, l]));
  const { inicioDia, agora } = janelaUltimosDias(90);

  const itens = new Map<string, { item_id: string; seller_id: string; store_name: string }>();

  for (const lojaId of LOJAS_AGENTE) {
    const loja = lojasProprias.get(lojaId);
    if (!loja || loja.ml_user_id === null) continue;

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
  }

  res.json([...itens.values()]);
});
