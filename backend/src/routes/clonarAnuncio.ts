import { Router } from "express";
import axios from "axios";
import { montarPreview, publicarClone } from "../services/clonarAnuncioService";
import { temAcessoLojaParaClonagem, lojasEfetivasParaClonagem } from "../services/usuariosService";
import { listLojas, getValidAccessToken } from "../services/tokenStore";

export const clonarAnuncioRouter = Router();

// TEMP: investigar o valor real de frete debitado do vendedor (comparado ao
// "Detalhe do recebimento" que o próprio Mercado Livre mostra) — o
// list_cost que usamos hoje pode não ser o valor realmente cobrado.
clonarAnuncioRouter.get("/debug-custo-envio", async (req, res) => {
  const lojaId = Number(req.query.lojaId);
  const id = String(req.query.id ?? "");
  const loja = (await listLojas()).find((l) => l.id === lojaId);
  if (!loja || loja.ml_user_id === null) {
    res.status(404).json({ error: "loja não encontrada" });
    return;
  }
  const token = await getValidAccessToken(loja.id);
  const headers = { Authorization: `Bearer ${token}` };

  const resultado: any = { idConsultado: id };

  try {
    const { data: order } = await axios.get(`https://api.mercadolibre.com/orders/${id}`, { headers });
    resultado.order = order;
    const shippingId = order.shipping?.id;
    if (shippingId) {
      try {
        const { data: shipment } = await axios.get(`https://api.mercadolibre.com/shipments/${shippingId}`, { headers });
        resultado.shipment = shipment;
      } catch (e: any) {
        resultado.shipmentError = e?.response?.data ?? e.message;
      }
      try {
        const { data: costs } = await axios.get(`https://api.mercadolibre.com/shipments/${shippingId}/costs`, { headers });
        resultado.shipmentCosts = costs;
      } catch (e: any) {
        resultado.shipmentCostsError = e?.response?.data ?? e.message;
      }
    }
  } catch (e: any) {
    resultado.orderError = e?.response?.data ?? e.message;

    // Pode não ser um order id — tenta como shipping id e como pack id direto.
    try {
      const { data: shipment } = await axios.get(`https://api.mercadolibre.com/shipments/${id}`, { headers });
      resultado.shipmentComoIdDireto = shipment;
      try {
        const { data: costs } = await axios.get(`https://api.mercadolibre.com/shipments/${id}/costs`, { headers });
        resultado.shipmentCostsComoIdDireto = costs;
      } catch (e2: any) {
        resultado.shipmentCostsComoIdDiretoError = e2?.response?.data ?? e2.message;
      }
    } catch (e2: any) {
      resultado.shipmentComoIdDiretoError = e2?.response?.data ?? e2.message;
    }
    try {
      const { data: pack } = await axios.get(`https://api.mercadolibre.com/packs/${id}`, { headers });
      resultado.pack = pack;
    } catch (e2: any) {
      resultado.packError = e2?.response?.data ?? e2.message;
    }
  }

  res.json(resultado);
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
