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
import {
  buscarVendas,
  listarPedidos as listarPedidosBling,
  paraTexto,
  pedidoCru,
} from "../services/blingPedidosService";
import { puxarContatos, sincronizarContatos } from "../services/blingContatosService";
import {
  rodadaEmAndamento,
  rodarEGuardar,
  ultimaRodadaAutomatica,
} from "../services/fabricaSincAutomaticaService";
import {
  padronizarCodigos,
  listarProdutos as listarProdutosBling,
  conferirContraSite,
  criarNoErpOqueFalta,
  gravarGtin,
  gravarPreco,
  definirSituacaoProdutos,
} from "../services/blingProdutosService";
import { conferirPlanilhaVendas } from "../services/fabricaVendasPlanilhaService";
import { skusFaltando, clientesFaltando } from "../services/fabricaImportarVendasService";

import {
  conferirContasPagar,
  procurarContatos,
  espiarContas,
  contasDoFornecedor,
} from "../services/blingContasService";

export const fabricaBlingRouter = Router();
// Callback fica num router próprio, separado do admin-gated acima — mesmo
// bug encontrado ao vivo no callback da Shopee (routes/shopee.ts): montar
// isso em "/api/fabrica-bling/callback" usando o MESMO fabricaBlingRouter
// (que internamente tem sua própria rota "/callback") exigiria
// "/api/fabrica-bling/callback/callback" pra bater — a URL real que o
// Bling chama nunca dava match nesse mount, caía direto no app.use
// seguinte com requireAuth e voltava "Não autenticado" pro navegador de
// quem estava autorizando (sem cookie de sessão nosso).
export const fabricaBlingCallbackRouter = Router();

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

// Conferencia de contas a pagar: so le, dos dois lados. O acerto e decisao do
// Hudson — numero que vira custo nao se corrige sozinho.
fabricaBlingRouter.get("/contas/por-fornecedor", async (req, res) => {
  const termo = String(req.query.termo ?? "").trim();
  if (termo.length < 3) return res.status(400).json({ error: "Termo curto demais." });
  try {
    res.json(await contasDoFornecedor(termo));
  } catch (err) {
    console.error("[bling-contas-fornecedor]", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Falha ao buscar." });
  }
});

fabricaBlingRouter.get("/contas/espiar", async (_req, res) => {
  try {
    res.json(await espiarContas());
  } catch (err) {
    console.error("[bling-contas-espiar]", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Falha ao espiar." });
  }
});

fabricaBlingRouter.get("/contas/conferir", async (req, res) => {
  // Literal, nao `new RegExp("...")`: dentro de string o \d vira só "d", e o
  // padrao virava ^d{4}-d{2}-d{2}$ — que nunca casa com uma data de verdade.
  // Toda data pedida caía no padrao, e a conferencia respondia sobre julho
  // enquanto a tela pedia agosto. Erro que nao da erro: o numero vem, so nao e
  // do periodo que voce pediu.
  const d = (v: unknown, padrao: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : padrao;
  const hoje = new Date().toISOString().slice(0, 10);
  try {
    res.json(await conferirContasPagar(d(req.query.de, "2026-07-01"), d(req.query.ate, hoje)));
  } catch (err) {
    console.error("[bling-contas]", err);
    res.status(400).json({
      error: err instanceof Error && err.message ? err.message : "Falha ao conferir as contas.",
    });
  }
});

fabricaBlingRouter.get("/contatos/procurar", async (req, res) => {
  const termo = String(req.query.termo ?? "").trim();
  if (termo.length < 3) return res.status(400).json({ error: "Termo curto demais." });
  try {
    res.json({ contatos: await procurarContatos(termo) });
  } catch (err) {
    console.error("[bling-contatos-procurar]", err);
    res.status(400).json({
      error: err instanceof Error && err.message ? err.message : "Falha ao procurar.",
    });
  }
});

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
fabricaBlingCallbackRouter.get("/", async (req: Request, res: Response) => {
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

// Puxar um mês de vendas leva mais de dez minutos: são uns dois mil pedidos e o
// Bling só deixa passar três chamadas por segundo. Nenhuma requisição HTTP
// sobrevive a isso — o proxy corta antes. Então a sincronização roda solta no
// servidor e a tela pergunta como está indo.
//
// Uma de cada vez, guardada em memória: são dois usuários, o trabalho é do mês
// inteiro e duas sincronizações ao mesmo tempo só dividiriam a cota do Bling
// pela metade.

interface Sincronizacao {
  id: string;
  de: string;
  ate: string;
  estado: "listando" | "puxando" | "pronto" | "erro";
  feitos: number;
  total: number;
  iniciadoEm: number;
  terminadoEm: number | null;
  resultado: Record<string, unknown> | null;
  erro: string | null;
}

let sinc: Sincronizacao | null = null;

async function rodarSincronizacao(job: Sincronizacao): Promise<void> {
  try {
    const r = await buscarVendas(job.de, job.ate, (feitos, total) => {
      job.estado = "puxando";
      job.feitos = feitos;
      job.total = total;
    });
    const texto = paraTexto(r.itens);
    const conf = await conferirPlanilhaVendas(texto, "BLING");
    job.resultado = {
      pedidos: r.pedidos,
      itensLidos: r.itens.length,
      falhas: r.falhas,
      texto,
      ...conf,
      skusFaltando: skusFaltando(conf.linhas),
      clientesFaltando: clientesFaltando(conf.linhas),
    };
    job.estado = "pronto";
  } catch (err) {
    console.error("[fabrica-bling] sincronizar", err);
    job.erro = err instanceof Error ? err.message : "Falha ao sincronizar com o Bling.";
    job.estado = "erro";
  } finally {
    job.terminadoEm = Date.now();
  }
}

// O que a tela precisa saber sem carregar o resultado inteiro junto.
function resumo(j: Sincronizacao) {
  return {
    id: j.id,
    de: j.de,
    ate: j.ate,
    estado: j.estado,
    feitos: j.feitos,
    total: j.total,
    erro: j.erro,
  };
}

fabricaBlingRouter.post("/sincronizar", (req, res) => {
  const b = req.body ?? {};
  const de = typeof b.dataInicial === "string" ? b.dataInicial : "";
  const ate = typeof b.dataFinal === "string" ? b.dataFinal : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
    return res.status(400).json({ error: "Informe o período no formato aaaa-mm-dd." });
  }
  if (sinc && (sinc.estado === "listando" || sinc.estado === "puxando")) {
    return res.status(409).json({
      error: `Já tem uma sincronização rodando (${sinc.de} a ${sinc.ate}). Espere terminar.`,
      ...resumo(sinc),
    });
  }
  const job: Sincronizacao = {
    id: crypto.randomBytes(8).toString("hex"),
    de,
    ate,
    estado: "listando",
    feitos: 0,
    total: 0,
    iniciadoEm: Date.now(),
    terminadoEm: null,
    resultado: null,
    erro: null,
  };
  sinc = job;
  // solta de propósito: quem acompanha é o GET abaixo
  void rodarSincronizacao(job);
  res.status(202).json(resumo(job));
});

// Como está indo. Quando termina, vem o resultado inteiro junto — a mesma
// conferência que a importação por arquivo devolve.
fabricaBlingRouter.get("/sincronizacao", (_req, res) => {
  if (!sinc) return res.json({ estado: "nenhuma" });
  res.json({ ...resumo(sinc), resultado: sinc.resultado });
});

// Espelha o cadastro de cliente daqui no contato do Bling — IE, e-mail,
// telefone e endereço. Casa por CNPJ, que é o que não muda de grafia.
//
// Nasce em simulação: `simular: false` no corpo é o que grava. Escrever no ERP
// mexe em cadastro que emite nota, e ver a lista antes custa uma chamada.
fabricaBlingRouter.post("/contatos/sincronizar", async (req, res) => {
  const b = req.body ?? {};
  const simulacao = b.simular !== false;
  // `criar: true` cadastra no Bling o cliente que não existe lá. Fica de fora
  // por padrão: cliente sem contato costuma ser nome escrito diferente, e
  // cadastrar em cima disso cria a duplicata em vez de resolver.
  const criar = b.criar === true;
  try {
    res.json(await sincronizarContatos(simulacao, criar));
  } catch (err) {
    erro(res, err, "Falha ao sincronizar os contatos do Bling.");
  }
});

// Padroniza o código do produto no Bling pelo código do site.
//
// Nasce em simulação, igual à sincronia de contato: código de produto é o que
// liga a venda ao cadastro, e trocar errado quebra o histórico dos dois lados.
// O contrario do sincronizar: preenche daqui o que o ERP sabe e o cadastro nao.
// So mexe em campo vazio — o que ja tem valor aqui sai na lista como divergente
// e fica pra decisao de quem manda a nota.
// Como foi a ultima rodada automatica. A tela mostra isso pra ninguem descobrir
// tres dias depois que a maquina parou de lancar.
// Devolve um pedido do Bling como ele vem, pra dar pra ver que campos existem
// de verdade em vez de confiar na documentacao. So leitura.
// Aceita o id interno do Bling ou o numero do pedido — que e o que aparece na
// tela dele e o unico que alguem tem na mao. Com numero, precisa da data pra
// achar o id sem varrer o historico inteiro.
fabricaBlingRouter.get("/pedido-cru/:id", async (req, res) => {
  let id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Id inválido." });
  }
  const data = typeof req.query.data === "string" ? req.query.data : "";
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      const doDia = await listarPedidosBling(data, data);
      const achado = doDia.find((p) => String(p.numero) === String(req.params.id));
      if (!achado) {
        return res.status(404).json({
          error: `Não achei o pedido ${req.params.id} em ${data}.`,
          numeros: doDia.map((p) => p.numero),
        });
      }
      id = achado.id;
    }
    res.json(await pedidoCru(id));
  } catch (err) {
    erro(res, err, "Falha ao ler o pedido no Bling.");
  }
});

fabricaBlingRouter.get("/automatica", (_req, res) => {
  res.json({ rodando: rodadaEmAndamento(), ultima: ultimaRodadaAutomatica() });
});

// Dispara a rodada automatica agora, sem esperar a manha seguinte.
fabricaBlingRouter.post("/automatica", async (_req, res) => {
  try {
    res.json(await rodarEGuardar());
  } catch (err) {
    erro(res, err, "Falha na sincronização automática.");
  }
});

fabricaBlingRouter.post("/contatos/puxar", async (req, res) => {
  const b = req.body ?? {};
  try {
    res.json(await puxarContatos(b.simular !== false));
  } catch (err) {
    erro(res, err, "Falha ao puxar os contatos do Bling.");
  }
});

fabricaBlingRouter.post("/produtos/padronizar", async (req, res) => {
  const b = req.body ?? {};
  const pares = Array.isArray(b.pares) ? b.pares : [];
  if (!pares.length) {
    return res.status(400).json({ error: "Mande os pares { de, para }." });
  }
  if (pares.length > 500) {
    return res.status(400).json({ error: "No máximo 500 códigos por vez." });
  }
  try {
    res.json(await padronizarCodigos(pares, b.simular !== false));
  } catch (err) {
    erro(res, err, "Falha ao padronizar os códigos.");
  }
});

// O catalogo inteiro do ERP, pra conferir contra o site e contra o SKU MASTER.
// Roda solto igual a sincronizacao de vendas: sao ~6 mil produtos a 3 chamadas
// por segundo.
let catalogoBling: {
  estado: "rodando" | "pronto" | "erro";
  lidos: number;
  erro: string | null;
  produtos: unknown[] | null;
} | null = null;

fabricaBlingRouter.post("/produtos/catalogo", (req, res) => {
  if (catalogoBling && catalogoBling.estado === "rodando") {
    return res.status(409).json({ error: "Já tem uma leitura rodando.", ...catalogoBling });
  }
  const job = {
    estado: "rodando" as const,
    lidos: 0,
    erro: null as string | null,
    produtos: null as unknown[] | null,
  };
  catalogoBling = job;
  void (async () => {
    try {
      const b = req.body ?? {};
      const filtros = Array.isArray(b.filtros) ? b.filtros : undefined;
      const lista = await listarProdutosBling((n) => {
        job.lidos = n;
      }, filtros);
      catalogoBling = { estado: "pronto", lidos: lista.length, erro: null, produtos: lista };
    } catch (err) {
      console.error("[fabrica-bling] catalogo", err);
      catalogoBling = {
        estado: "erro",
        lidos: job.lidos,
        erro: err instanceof Error ? err.message : "falha ao ler o catálogo",
        produtos: null,
      };
    }
  })();
  res.status(202).json({ estado: "rodando" });
});

fabricaBlingRouter.get("/produtos/catalogo", (_req, res) => {
  if (!catalogoBling) return res.json({ estado: "nenhuma" });
  res.json(catalogoBling);
});

// A conferencia do que ja foi lido: ERP contra site, so as divergencias.
fabricaBlingRouter.get("/produtos/conferir", async (_req, res) => {
  if (!catalogoBling || catalogoBling.estado !== "pronto" || !catalogoBling.produtos) {
    return res.status(400).json({
      error: "Leia o catálogo do ERP primeiro (POST /produtos/catalogo).",
    });
  }
  try {
    res.json(await conferirContraSite(catalogoBling.produtos as never[]));
  } catch (err) {
    erro(res, err, "Falha ao conferir o catálogo.");
  }
});

// Cadastra no ERP o que existe no site e nao la. Roda solto: sao milhares de
// produtos a 3 chamadas por segundo.
//
// `simular: true` (o padrao) so lista. `limite` corta a lista — serve pra
// mandar cinco primeiro e conferir no Bling antes de soltar o resto.
let criacaoErp: {
  estado: "rodando" | "pronto" | "erro";
  feitos: number;
  total: number;
  erro: string | null;
  resultado: unknown | null;
} | null = null;

fabricaBlingRouter.post("/produtos/criar-faltantes", (req, res) => {
  if (criacaoErp && criacaoErp.estado === "rodando") {
    return res.status(409).json({ error: "Já tem um cadastro rodando.", ...criacaoErp });
  }
  if (!catalogoBling || catalogoBling.estado !== "pronto" || !catalogoBling.produtos) {
    return res.status(400).json({
      error: "Leia o catálogo do ERP primeiro (POST /produtos/catalogo).",
    });
  }
  const b = req.body ?? {};
  const simulacao = b.simular !== false;
  const limite = Number.isFinite(Number(b.limite)) ? Number(b.limite) : 0;
  // `inativos: true` traz tambem o que esta inativo no site — e eles nascem
  // inativos no Bling, nao ativos
  const inativos = b.inativos === true;
  const job = {
    estado: "rodando" as const,
    feitos: 0,
    total: 0,
    erro: null as string | null,
    resultado: null as unknown,
  };
  criacaoErp = job;
  const produtos = catalogoBling.produtos as never[];
  void (async () => {
    try {
      const r = await criarNoErpOqueFalta(produtos, simulacao, limite, inativos, (f, t) => {
        job.feitos = f;
        job.total = t;
      });
      criacaoErp = {
        estado: "pronto", feitos: r.linhas.length, total: r.linhas.length,
        erro: null, resultado: r,
      };
    } catch (err) {
      console.error("[fabrica-bling] criar", err);
      criacaoErp = {
        estado: "erro", feitos: job.feitos, total: job.total,
        erro: err instanceof Error ? err.message : "falha ao cadastrar", resultado: null,
      };
    }
  })();
  res.status(202).json({ estado: "rodando", simulacao });
});

fabricaBlingRouter.get("/produtos/criar-faltantes", (_req, res) => {
  if (!criacaoErp) return res.json({ estado: "nenhuma" });
  res.json(criacaoErp);
});

// Grava o codigo de barras nos produtos do ERP. Roda solto: cada SKU custa tres
// chamadas — procurar, ler e devolver.
let gtinJob: {
  estado: "rodando" | "pronto" | "erro";
  feitos: number;
  total: number;
  erro: string | null;
  resultado: unknown | null;
} | null = null;

let precoJob: { estado: string; feitos: number; total: number; erro: string | null; resultado: unknown } | null =
  null;

fabricaBlingRouter.post("/produtos/preco", (req, res) => {
  if (precoJob && precoJob.estado === "rodando") {
    return res.status(409).json({ error: "Já tem uma gravação de preço rodando.", ...precoJob });
  }
  const b = req.body ?? {};
  const pares = Array.isArray(b.pares)
    ? b.pares
        .map((p: { sku?: unknown; preco?: unknown }) => ({
          sku: String(p.sku ?? "").trim(),
          preco: Number(p.preco),
        }))
        .filter((p: { sku: string; preco: number }) => p.sku && Number.isFinite(p.preco) && p.preco > 0)
    : [];
  if (!pares.length) {
    return res.status(400).json({ error: "Mande os pares { sku, preco }." });
  }
  const simulacao = b.simular !== false;
  const job = {
    estado: "rodando" as const, feitos: 0, total: pares.length,
    erro: null as string | null, resultado: null as unknown,
  };
  precoJob = job;
  void (async () => {
    try {
      const r = await gravarPreco(pares, simulacao, (f, t) => {
        job.feitos = f;
        job.total = t;
      });
      precoJob = { estado: "pronto", feitos: r.linhas.length, total: r.linhas.length,
        erro: null, resultado: r };
    } catch (err) {
      console.error("[fabrica-bling] preco", err);
      precoJob = { estado: "erro", feitos: job.feitos, total: job.total,
        erro: err instanceof Error ? err.message : "falha", resultado: null };
    }
  })();
  res.status(202).json({ estado: "rodando", total: pares.length });
});

fabricaBlingRouter.get("/produtos/preco", (_req, res) => {
  res.json(precoJob ?? { estado: "nenhuma" });
});

fabricaBlingRouter.post("/produtos/gtin", (req, res) => {
  if (gtinJob && gtinJob.estado === "rodando") {
    return res.status(409).json({ error: "Já tem uma gravação rodando.", ...gtinJob });
  }
  const b = req.body ?? {};
  const pares = Array.isArray(b.pares)
    ? b.pares
        .map((p: { sku?: unknown; gtin?: unknown }) => ({
          sku: String(p.sku ?? "").trim(),
          gtin: String(p.gtin ?? "").replace(/\D/g, ""),
        }))
        .filter((p: { sku: string; gtin: string }) => p.sku && p.gtin.length >= 8)
    : [];
  if (!pares.length) {
    return res.status(400).json({ error: "Mande os pares { sku, gtin }." });
  }
  const simulacao = b.simular !== false;
  const job = {
    estado: "rodando" as const, feitos: 0, total: pares.length,
    erro: null as string | null, resultado: null as unknown,
  };
  gtinJob = job;
  void (async () => {
    try {
      const r = await gravarGtin(pares, simulacao, (f, t) => {
        job.feitos = f;
        job.total = t;
      });
      gtinJob = { estado: "pronto", feitos: r.linhas.length, total: r.linhas.length,
        erro: null, resultado: r };
    } catch (err) {
      console.error("[fabrica-bling] gtin", err);
      gtinJob = { estado: "erro", feitos: job.feitos, total: job.total,
        erro: err instanceof Error ? err.message : "falha", resultado: null };
    }
  })();
  res.status(202).json({ estado: "rodando", total: pares.length, simulacao });
});

fabricaBlingRouter.get("/produtos/gtin", (_req, res) => {
  if (!gtinJob) return res.json({ estado: "nenhuma" });
  res.json(gtinJob);
});

// Inativa produto no ERP. Inativa, nunca exclui.
let inativarJob: {
  estado: "rodando" | "pronto" | "erro";
  feitos: number;
  total: number;
  erro: string | null;
  resultado: unknown | null;
} | null = null;

fabricaBlingRouter.post("/produtos/inativar", (req, res) => {
  if (inativarJob && inativarJob.estado === "rodando") {
    return res.status(409).json({ error: "Já tem uma inativação rodando.", ...inativarJob });
  }
  const b = req.body ?? {};
  const skus = Array.isArray(b.skus)
    ? b.skus.map((x: unknown) => String(x ?? "").trim()).filter(Boolean)
    : [];
  if (!skus.length) return res.status(400).json({ error: "Mande a lista de skus." });
  // "A" reativa. Cor nova aparece na venda antes de existir no cadastro, e o
  // codigo que foi inativado por nao ter par precisa de caminho de volta.
  const situacao: "A" | "I" = b.situacao === "A" ? "A" : "I";
  const simulacao = b.simular !== false;
  const job = {
    estado: "rodando" as const, feitos: 0, total: skus.length,
    erro: null as string | null, resultado: null as unknown,
  };
  inativarJob = job;
  void (async () => {
    try {
      const r = await definirSituacaoProdutos(skus, situacao, simulacao, (f, t) => {
        job.feitos = f;
        job.total = t;
      });
      inativarJob = { estado: "pronto", feitos: r.linhas.length, total: r.linhas.length,
        erro: null, resultado: r };
    } catch (err) {
      console.error("[fabrica-bling] inativar", err);
      inativarJob = { estado: "erro", feitos: job.feitos, total: job.total,
        erro: err instanceof Error ? err.message : "falha", resultado: null };
    }
  })();
  res.status(202).json({ estado: "rodando", total: skus.length, simulacao });
});

fabricaBlingRouter.get("/produtos/inativar", (_req, res) => {
  if (!inativarJob) return res.json({ estado: "nenhuma" });
  res.json(inativarJob);
});
