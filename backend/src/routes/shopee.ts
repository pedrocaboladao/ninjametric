import { Router, Request, Response } from "express";
import { pool } from "../db/pool";
import {
  configurado,
  chamarApiAssinada,
  salvarToken,
  trocarCodigo,
  urlDeAutorizacao,
} from "../services/shopeeAuth";

export const shopeeRouter = Router();

function erro(res: Response, err: unknown, padrao: string) {
  console.error("[shopee]", err);
  res.status(400).json({ error: err instanceof Error ? err.message : padrao });
}

// Devolve a URL em vez de redirecionar: a tela chama por fetch, e um 302
// numa chamada XHR não abre janela nenhuma (mesmo padrão do Bling).
shopeeRouter.get("/:lojaId/autorizar", (req, res) => {
  const lojaId = Number(req.params.lojaId);
  if (!Number.isInteger(lojaId)) {
    res.status(400).json({ error: "lojaId inválido." });
    return;
  }
  try {
    if (!configurado()) {
      res.status(400).json({ error: "Falta configurar SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY no servidor." });
      return;
    }
    res.json({ url: urlDeAutorizacao(lojaId) });
  } catch (err) {
    erro(res, err, "Falha ao montar a autorização.");
  }
});

// A Shopee manda o navegador de volta pra cá com code + shop_id — lojaId
// vem do nosso próprio redirect (a Shopee não suporta "state" nesse link,
// ver shopeeAuth.ts). Responde HTML, não JSON: quem lê é uma janela aberta.
shopeeRouter.get("/callback", async (req: Request, res: Response) => {
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
    res.send(pagina("Shopee conectada", `Loja ${lojaId} autorizada (shop_id ${shopId}).`));
  } catch (err) {
    console.error("[shopee] callback", err);
    const motivo = err instanceof Error ? err.message : "Erro desconhecido ao trocar o código.";
    res
      .status(400)
      .send(
        pagina(
          "Não deu para conectar",
          `<code style="opacity:.85">${motivo.replace(/[<>]/g, "")}</code>`
        )
      );
  }
});

shopeeRouter.get("/status", async (_req, res) => {
  try {
    const { rows } = await pool.query<{ loja_id: number; nome: string; shop_id: string; atualizado_em: string }>(
      `SELECT l.id AS loja_id, l.nome, c.shop_id, c.atualizado_em
       FROM lojas l LEFT JOIN contas_shopee c ON c.loja_id = l.id
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

// Diagnóstico da fase 1 — só confirma que a canalização inteira funciona
// (autorizou, token válido, chamada assinada aceita). Não é o endpoint
// definitivo do Financeiro Shopee (fase 2).
shopeeRouter.get("/pedidos-teste", async (req, res) => {
  const lojaId = Number(req.query.lojaId);
  if (!Number.isInteger(lojaId)) {
    res.status(400).json({ error: "Informe ?lojaId=" });
    return;
  }
  try {
    const agora = Math.floor(Date.now() / 1000);
    const seteDiasAtras = agora - 7 * 24 * 60 * 60;
    const data = await chamarApiAssinada<{
      response?: { order_list?: { order_sn: string }[]; more?: boolean };
      error?: string;
      message?: string;
    }>(lojaId, "/api/v2/order/get_order_list", {
      time_range_field: "create_time",
      time_from: seteDiasAtras,
      time_to: agora,
      page_size: 50,
    });
    if (data.error) {
      res.status(400).json({ error: `Shopee respondeu "${data.error}": ${data.message ?? ""}` });
      return;
    }
    res.json({
      pedidosEncontrados: data.response?.order_list?.length ?? 0,
      temMaisPaginas: data.response?.more ?? false,
      amostra: data.response?.order_list?.slice(0, 5) ?? [],
    });
  } catch (err) {
    erro(res, err, "Falha ao buscar pedidos de teste.");
  }
});
