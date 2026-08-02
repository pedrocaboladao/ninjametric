import { Router } from "express";
import axios from "axios";
import { montarPreview, publicarClone } from "../services/clonarAnuncioService";
import { temAcessoLojaParaClonagem, lojasEfetivasParaClonagem } from "../services/usuariosService";
import { listLojas, getValidAccessToken } from "../services/tokenStore";

export const clonarAnuncioRouter = Router();

// TEMP: investigar modalidades de frete reais (logistic_type/mode) e dados
// de devolução/reembolso disponíveis nos pedidos, pra planejar a quebra por
// modalidade e devoluções parciais no Financeiro.
clonarAnuncioRouter.get("/debug-modalidades", async (req, res) => {
  const janelaDias = Number(req.query.dias ?? 30);
  const desde = new Date(Date.now() - janelaDias * 24 * 60 * 60 * 1000).toISOString();
  const ate = new Date().toISOString();

  const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null);
  const resultado: Record<string, unknown> = {};

  for (const loja of lojas) {
    const token = await getValidAccessToken(loja.id);
    try {
      const { data } = await axios.get("https://api.mercadolibre.com/orders/search", {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          seller: loja.ml_user_id,
          "order.date_created.from": desde,
          "order.date_created.to": ate,
          sort: "date_desc",
          limit: 20,
        },
      });

      const modalidades = new Map<string, number>();
      const statusPagamento = new Map<string, number>();
      let comReembolsoParcial = 0;
      const exemplosReembolso: unknown[] = [];

      await Promise.all(
        (data.results as any[]).map(async (o) => {
          const shippingId = o.shipping?.id;
          if (shippingId) {
            try {
              const { data: shipment } = await axios.get(`https://api.mercadolibre.com/shipments/${shippingId}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const chave = `${shipment.logistic_type ?? "?"} / mode=${shipment.mode ?? "?"}`;
              modalidades.set(chave, (modalidades.get(chave) ?? 0) + 1);
            } catch {
              modalidades.set("erro_ao_buscar_envio", (modalidades.get("erro_ao_buscar_envio") ?? 0) + 1);
            }
          } else {
            modalidades.set("sem_shipping_id", (modalidades.get("sem_shipping_id") ?? 0) + 1);
          }
        })
      );

      for (const o of data.results as any[]) {
        for (const p of o.payments ?? []) {
          statusPagamento.set(p.status, (statusPagamento.get(p.status) ?? 0) + 1);
          if (p.transaction_amount_refunded > 0) {
            comReembolsoParcial++;
            if (exemplosReembolso.length < 3) {
              exemplosReembolso.push({
                orderId: o.id,
                status: p.status,
                status_detail: p.status_detail,
                transaction_amount: p.transaction_amount,
                transaction_amount_refunded: p.transaction_amount_refunded,
              });
            }
          }
        }
      }

      resultado[loja.nome] = {
        totalPedidos: data.results.length,
        modalidades: Object.fromEntries(modalidades),
        statusPagamento: Object.fromEntries(statusPagamento),
        comReembolsoParcial,
        exemplosReembolso,
      };
    } catch (err: any) {
      resultado[loja.nome] = { erro: err.message };
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
