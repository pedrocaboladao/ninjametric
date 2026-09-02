import { Router, Request, Response } from "express";
import { pool } from "../db/pool";
import { configurado, chamarApiAssinada, salvarToken, trocarCodigo, urlDeAutorizacao } from "../services/shopeeAdsAuth";

export const shopeeAdsRouter = Router();
// Callback num router próprio, sem requireAuth — mesmo motivo do
// shopeeCallbackRouter em routes/shopee.ts: quem chama essa URL é o
// navegador do vendedor voltando da tela de autorização da Shopee, sem
// cookie de sessão nosso.
export const shopeeAdsCallbackRouter = Router();

function erro(res: Response, err: unknown, padrao: string) {
  console.error("[shopee-ads]", err);
  res.status(400).json({ error: err instanceof Error ? err.message : padrao });
}

shopeeAdsRouter.get("/:lojaId/autorizar", (req, res) => {
  const lojaId = Number(req.params.lojaId);
  if (!Number.isInteger(lojaId)) {
    res.status(400).json({ error: "lojaId inválido." });
    return;
  }
  try {
    if (!configurado()) {
      res.status(400).json({ error: "Falta configurar SHOPEE_ADS_PARTNER_ID e SHOPEE_ADS_PARTNER_KEY no servidor." });
      return;
    }
    res.json({ url: urlDeAutorizacao(lojaId) });
  } catch (err) {
    erro(res, err, "Falha ao montar a autorização.");
  }
});

shopeeAdsCallbackRouter.get("/", async (req: Request, res: Response) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const shopId = Number(req.query.shop_id);
  const lojaId = Number(req.query.lojaId);
  const pagina = (titulo: string, texto: string) =>
    `<!doctype html><meta charset="utf-8"><title>${titulo}</title>` +
    `<body style="font-family:system-ui;background:#111;color:#eee;padding:40px">` +
    `<h2>${titulo}</h2><p>${texto}</p>` +
    `<p style="opacity:.6">Pode fechar esta janela.</p></body>`;

  if (!code || !Number.isInteger(shopId) || !Number.isInteger(lojaId)) {
    res.status(400).send(pagina("Autorização não reconhecida", "Comece de novo pela tela de integração."));
    return;
  }

  try {
    const token = await trocarCodigo(code, shopId);
    await salvarToken(lojaId, shopId, token);
    res.send(pagina("Shopee Ads conectado", `Loja ${lojaId} autorizada pro app de Ads (shop_id ${shopId}).`));
  } catch (err) {
    console.error("[shopee-ads] callback", err);
    const motivo = err instanceof Error ? err.message : "Erro desconhecido ao trocar o código.";
    res
      .status(400)
      .send(pagina("Não deu para conectar", `<code style="opacity:.85">${motivo.replace(/[<>]/g, "")}</code>`));
  }
});

shopeeAdsRouter.get("/status", async (_req, res) => {
  try {
    const { rows } = await pool.query<{ loja_id: number; nome: string; shop_id: string; atualizado_em: string }>(
      `SELECT l.id AS loja_id, l.nome, c.shop_id, c.atualizado_em
       FROM lojas l LEFT JOIN contas_shopee_ads c ON c.loja_id = l.id
       ORDER BY l.id`
    );
    res.json({
      configurado: configurado(),
      lojas: rows.map((r) => ({
        lojaId: r.loja_id,
        nome: r.nome,
        conectado: r.shop_id !== null,
        shopId: r.shop_id !== null ? Number(r.shop_id) : null,
        atualizadoEm: r.atualizado_em,
      })),
    });
  } catch (err) {
    erro(res, err, "Falha ao consultar o status.");
  }
});

// Diagnóstico — confirma que o app de Ads (separado do principal) consegue
// chamar de verdade um endpoint de Ads. Remover depois de confirmar.
shopeeAdsRouter.get("/ads-teste", async (req, res) => {
  const lojaId = Number(req.query.lojaId);
  if (!Number.isInteger(lojaId)) {
    res.status(400).json({ error: "Informe ?lojaId=" });
    return;
  }
  try {
    // A Shopee quer DD-MM-YYYY aqui (confirmado ao vivo — o formato
    // ISO YYYY-MM-DD que outros endpoints da Shopee aceitam dá
    // "error_param" nesse em especial).
    const paraDDMMYYYY = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
    const agora = new Date();
    const seteDiasAtras = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
    const data = await chamarApiAssinada(lojaId, "/api/v2/ads/get_all_cpc_ads_daily_performance", {
      start_date: paraDDMMYYYY(seteDiasAtras),
      end_date: paraDDMMYYYY(agora),
    });
    res.json(data);
  } catch (err) {
    erro(res, err, "Falha ao testar o Ads.");
  }
});
