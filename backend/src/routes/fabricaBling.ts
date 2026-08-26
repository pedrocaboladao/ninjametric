import { Router, Request, Response } from "express";
import crypto from "crypto";
import {
  configurado,
  desconectar,
  guardarToken,
  status,
  trocarCodigo,
  urlDeAutorizacao,
} from "../services/blingAuth";
import { buscarVendas, paraTexto } from "../services/blingPedidosService";
import { conferirPlanilhaVendas } from "../services/fabricaVendasPlanilhaService";
import { skusFaltando } from "../services/fabricaImportarVendasService";

export const fabricaBlingRouter = Router();

// O state liga o retorno do Bling à sessão que começou a autorização. Fica em
// memória de propósito: vale um minuto — o code do Bling expira nesse tempo —
// e guardar em banco algo que morre em 60 segundos não paga o custo.
const estados = new Map<string, number>();

function limparEstados(): void {
  const agora = Date.now();
  for (const [k, t] of estados) if (agora - t > 10 * 60 * 1000) estados.delete(k);
}

function erro(res: Response, err: unknown, padrao: string) {
  console.error("[fabrica-bling]", err);
  res.status(400).json({ error: err instanceof Error ? err.message : padrao });
}

fabricaBlingRouter.get("/status", async (_req, res) => {
  try {
    res.json(await status());
  } catch (err) {
    erro(res, err, "Falha ao consultar o status.");
  }
});

// Devolve a URL em vez de redirecionar: quem chama é a tela por fetch, e um
// 302 numa chamada XHR não abre janela nenhuma.
fabricaBlingRouter.get("/autorizar", (_req, res) => {
  try {
    if (!configurado()) {
      return res.status(400).json({
        error:
          "Falta configurar BLING_CLIENT_ID, BLING_CLIENT_SECRET e BLING_REDIRECT_URI no servidor.",
      });
    }
    limparEstados();
    const state = crypto.randomBytes(16).toString("hex");
    estados.set(state, Date.now());
    res.json({ url: urlDeAutorizacao(state) });
  } catch (err) {
    erro(res, err, "Falha ao montar a autorização.");
  }
});

// O Bling manda o navegador de volta pra cá. Responde HTML, não JSON: quem
// está lendo é uma janela aberta, não um fetch.
fabricaBlingRouter.get("/callback", async (req: Request, res: Response) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const pagina = (titulo: string, texto: string) =>
    `<!doctype html><meta charset="utf-8"><title>${titulo}</title>` +
    `<body style="font-family:system-ui;background:#111;color:#eee;padding:40px">` +
    `<h2>${titulo}</h2><p>${texto}</p>` +
    `<p style="opacity:.6">Pode fechar esta janela.</p></body>`;

  if (!code || !estados.has(state)) {
    return res
      .status(400)
      .send(pagina("Autorização não reconhecida", "Comece de novo pela tela de integração."));
  }
  estados.delete(state);
  try {
    await guardarToken(await trocarCodigo(code));
    res.send(pagina("Bling conectado", "A sincronização de vendas já pode ser usada."));
  } catch (err) {
    console.error("[fabrica-bling] callback", err);
    const motivo =
      err instanceof Error ? err.message : "Erro desconhecido ao trocar o código.";
    res
      .status(400)
      .send(
        pagina(
          "Não deu para conectar",
          `<code style="opacity:.85">${motivo.replace(/[<>]/g, "")}</code>` +
            "<br><br>O código do Bling vale um minuto — se demorou, autorize de novo."
        )
      );
  }
});

fabricaBlingRouter.delete("/conexao", async (_req, res) => {
  try {
    await desconectar();
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao desconectar.");
  }
});

// Puxa as vendas do período e devolve a conferência de sempre, mais o texto.
// Nada é lançado aqui — quem lança é a rota de importar planilha, com o texto
// que volta daqui. Assim o caminho do Bling e o do arquivo terminam iguais.
fabricaBlingRouter.post("/sincronizar", async (req, res) => {
  const b = req.body ?? {};
  const de = typeof b.dataInicial === "string" ? b.dataInicial : "";
  const ate = typeof b.dataFinal === "string" ? b.dataFinal : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
    return res.status(400).json({ error: "Informe o período no formato aaaa-mm-dd." });
  }
  try {
    const r = await buscarVendas(de, ate);
    const texto = paraTexto(r.itens);
    const conf = await conferirPlanilhaVendas(texto, "BLING");
    res.json({
      pedidos: r.pedidos,
      itensLidos: r.itens.length,
      falhas: r.falhas,
      texto,
      ...conf,
      skusFaltando: skusFaltando(conf.linhas),
    });
  } catch (err) {
    erro(res, err, "Falha ao sincronizar com o Bling.");
  }
});
