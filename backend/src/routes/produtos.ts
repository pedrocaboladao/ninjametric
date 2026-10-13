import { Router } from "express";
import { listarProdutos } from "../services/produtosService";
import { listLojas } from "../services/tokenStore";
import { listarItensAtivos, getItemsBasicInfo } from "../services/mercadoLivreApi";

export const produtosRouter = Router();

// `?atualizar=1` ignora o cache de 1 hora e rele a planilha do Google Sheets.
//
// Existe porque a MASTER e editada por gente, e o cache escondia o trabalho
// recem-feito: em 09/10/2026, conferir se o editor tinha aplicado uma correcao
// virava esperar o cache vencer ou adivinhar. Sem o passe, a leitura continua
// cacheada — a tela nao precisa buscar 5 mil linhas a cada carregamento.
produtosRouter.get("/", async (req, res) => {
  const atualizar = req.query.atualizar === "1" || req.query.atualizar === "true";
  try {
    const produtos = await listarProdutos(atualizar);
    res.json({ produtos });
  } catch (err) {
    console.error("Erro ao listar produtos:", err);
    res.status(500).json({ error: "Falha ao carregar a planilha de produtos." });
  }
});

// Diagnóstico temporário — lista anúncios ativos de uma loja sem NET_WEIGHT
// declarado (achado real: causa frete calculado errado). Remover depois de
// usar.
produtosRouter.get("/diag-peso-ausente", async (req, res) => {
  const lojaId = Number(req.query.lojaId);
  if (!Number.isInteger(lojaId)) {
    res.status(400).json({ error: "Informe ?lojaId=" });
    return;
  }
  try {
    const loja = (await listLojas()).find((l) => l.id === lojaId);
    if (!loja || !loja.ml_user_id) {
      res.status(404).json({ error: "Loja não encontrada ou sem ml_user_id." });
      return;
    }
    const itemIds = await listarItensAtivos(loja.id, loja.ml_user_id);
    const info = await getItemsBasicInfo(loja.id, itemIds);
    const semPeso: { itemId: string; titulo: string; sku: string | null }[] = [];
    for (const item of info.values()) {
      const atributos = (item as unknown as { attributes?: { id: string }[] }).attributes ?? [];
      const temPeso = atributos.some((a) => a.id === "NET_WEIGHT");
      if (!temPeso) {
        semPeso.push({ itemId: item.id, titulo: item.title, sku: item.seller_custom_field ?? null });
      }
    }
    res.json({ lojaNome: loja.nome, totalAtivos: itemIds.length, totalSemPeso: semPeso.length, itens: semPeso });
  } catch (err) {
    console.error("Erro no diagnóstico de peso ausente:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Falha no diagnóstico." });
  }
});
