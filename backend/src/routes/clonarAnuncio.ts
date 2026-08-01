import { Router } from "express";
import axios from "axios";
import { montarPreview, publicarClone } from "../services/clonarAnuncioService";
import { temAcessoLojaParaClonagem, lojasEfetivasParaClonagem } from "../services/usuariosService";
import { listLojas, getValidAccessToken } from "../services/tokenStore";

export const clonarAnuncioRouter = Router();

// TEMP: checar cubagem/frete real de um item específico (aceita MLB ou MLBU).
clonarAnuncioRouter.get("/debug-item", async (req, res) => {
  const idBruto = String(req.query.id ?? "");
  const userProductMatch = idBruto.match(/MLBU(\d+)/i);
  const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null);

  for (const loja of lojas) {
    const token = await getValidAccessToken(loja.id);
    try {
      let itemId = idBruto;
      if (userProductMatch) {
        const { data: busca } = await axios.get(
          `https://api.mercadolibre.com/users/${loja.ml_user_id}/items/search`,
          { headers: { Authorization: `Bearer ${token}` }, params: { user_product_id: `MLBU${userProductMatch[1]}` } }
        );
        const encontrado = busca.results?.[0];
        if (!encontrado) continue;
        itemId = encontrado;
      }

      const { data: item } = await axios.get(`https://api.mercadolibre.com/items/${itemId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      let opcoesFrete: unknown = null;
      try {
        const { data } = await axios.get(`https://api.mercadolibre.com/items/${itemId}/shipping_options`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { zip_code: "01310100" },
        });
        opcoesFrete = data;
      } catch (err: any) {
        opcoesFrete = { erro: err.response?.data ?? err.message };
      }

      const cubagem = item.attributes?.filter((a: any) =>
        ["SELLER_PACKAGE_WEIGHT", "SELLER_PACKAGE_HEIGHT", "SELLER_PACKAGE_WIDTH", "SELLER_PACKAGE_LENGTH"].includes(a.id)
      );

      res.json({
        loja: loja.nome,
        itemId,
        category_id: item.category_id,
        price: item.price,
        shipping: item.shipping,
        cubagem,
        opcoesFrete,
      });
      return;
    } catch {
      // não é dessa loja
    }
  }

  res.status(404).json({ error: "não encontrado em nenhuma loja" });
});

// TEMP: checar se o frete alto é um problema da conta/loja de destino (não
// do clone em si) — olha o logistic_type de anúncios JÁ existentes e
// antigos dessa loja, criados direto no Mercado Livre, não pelo clonador.
clonarAnuncioRouter.get("/debug-loja", async (req, res) => {
  const lojaId = Number(req.query.lojaId);
  const loja = (await listLojas()).find((l) => l.id === lojaId);
  if (!loja || loja.ml_user_id === null) {
    res.status(404).json({ error: "loja não encontrada" });
    return;
  }
  const token = await getValidAccessToken(loja.id);

  const { data: busca } = await axios.get(`https://api.mercadolibre.com/users/${loja.ml_user_id}/items/search`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { status: "active", limit: 5 },
  });

  const itens = await Promise.all(
    (busca.results as string[]).map(async (itemId) => {
      const { data: item } = await axios.get(`https://api.mercadolibre.com/items/${itemId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { itemId, title: item.title, category_id: item.category_id, shipping: item.shipping };
    })
  );

  res.json({ loja: loja.nome, itens });
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
