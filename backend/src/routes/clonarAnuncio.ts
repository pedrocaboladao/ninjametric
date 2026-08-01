import { Router } from "express";
import axios from "axios";
import { montarPreview, publicarClone } from "../services/clonarAnuncioService";
import { temAcessoLojaParaClonagem, lojasEfetivasParaClonagem } from "../services/usuariosService";
import { listLojas, getValidAccessToken } from "../services/tokenStore";
import { listarProdutos } from "../services/produtosService";

export const clonarAnuncioRouter = Router();

// TEMP: validar estrutura real de order_items (sale_fee existe?) e se o
// seller_sku bate com o SKU da planilha de produtos.
clonarAnuncioRouter.get("/debug-financeiro", async (req, res) => {
  const lojaId = Number(req.query.lojaId ?? 1);
  const loja = (await listLojas()).find((l) => l.id === lojaId);
  if (!loja || loja.ml_user_id === null) {
    res.status(404).json({ error: "loja não encontrada" });
    return;
  }
  const token = await getValidAccessToken(loja.id);

  const { data } = await axios.get("https://api.mercadolibre.com/orders/search", {
    headers: { Authorization: `Bearer ${token}` },
    params: { seller: loja.ml_user_id, sort: "date_desc", limit: 5 },
  });

  const produtos = await listarProdutos();
  const skusPlanilha = new Set(produtos.map((p) => p.sku));

  const ordersResumo = (data.results as any[]).map((o) => ({
    id: o.id,
    order_items: o.order_items.map((oi: any) => ({
      sku: oi.item?.seller_sku,
      sale_fee: oi.sale_fee,
      unit_price: oi.unit_price,
      quantity: oi.quantity,
      bateComPlanilha: oi.item?.seller_sku ? skusPlanilha.has(oi.item.seller_sku) : false,
    })),
  }));

  res.json({ loja: loja.nome, ordersResumo });
});

// Lista de lojas disponíveis como destino do clone — usa a regra específica de
// clonagem (temAcessoLojaParaClonagem), que pode ser mais ampla que a lista
// geral de "lojas com acesso" usada pelo Dashboard/Perguntas.
clonarAnuncioRouter.get("/lojas", async (req, res) => {
  try {
    const usuario = req.usuario!;
    const lojas = (await listLojas()).filter(
      (l) => l.ml_user_id !== null && temAcessoLojaParaClonagem(usuario, l.id)
    );
    res.json({ lojas: lojas.map((l) => ({ id: l.id, nome: l.nome })) });
  } catch (err) {
    console.error("Erro ao listar lojas para clonagem:", err);
    res.status(500).json({ error: "Falha ao listar lojas." });
  }
});

clonarAnuncioRouter.post("/preview", async (req, res) => {
  const { url, lojaDestinoId } = req.body;
  const usuario = req.usuario!;

  if (typeof url !== "string" || !url.trim() || !Number.isInteger(lojaDestinoId)) {
    res.status(400).json({ error: "Informe a URL do anúncio e a loja de destino." });
    return;
  }
  if (!temAcessoLojaParaClonagem(usuario, lojaDestinoId)) {
    res.status(403).json({ error: "Você não tem acesso a essa loja de destino." });
    return;
  }

  try {
    const preview = await montarPreview(url.trim(), lojasEfetivasParaClonagem(usuario));
    res.json(preview);
  } catch (err) {
    console.error("Erro ao montar preview do clone:", err);
    const mensagem = err instanceof Error ? err.message : "Falha ao ler o anúncio original.";
    res.status(500).json({ error: mensagem });
  }
});

clonarAnuncioRouter.post("/publicar", async (req, res) => {
  const { url, lojaDestinoId, titulos, listingType, ativarFlex, imagensPersonalizadas, imagensPorVariacao } =
    req.body;
  const usuario = req.usuario!;

  if (
    typeof url !== "string" ||
    !url.trim() ||
    !Number.isInteger(lojaDestinoId) ||
    !Array.isArray(titulos) ||
    titulos.length === 0 ||
    titulos.some((t) => typeof t !== "string" || !t.trim()) ||
    typeof listingType !== "string"
  ) {
    res.status(400).json({ error: "Parâmetros inválidos para publicar o clone." });
    return;
  }
  if (!temAcessoLojaParaClonagem(usuario, lojaDestinoId)) {
    res.status(403).json({ error: "Você não tem acesso a essa loja de destino." });
    return;
  }

  try {
    const resultados = await publicarClone(
      url.trim(),
      lojaDestinoId,
      {
        titulos: titulos.map((t: string) => t.trim()),
        listingType,
        ativarFlex: Boolean(ativarFlex),
        imagensPersonalizadas: Array.isArray(imagensPersonalizadas) ? imagensPersonalizadas : undefined,
        imagensPorVariacao:
          imagensPorVariacao && typeof imagensPorVariacao === "object" ? imagensPorVariacao : undefined,
      },
      lojasEfetivasParaClonagem(usuario)
    );
    res.json({ resultados });
  } catch (err) {
    console.error("Erro ao publicar clone:", err);
    const mensagem = err instanceof Error ? err.message : "Falha ao publicar o anúncio clonado.";
    res.status(500).json({ error: mensagem });
  }
});
