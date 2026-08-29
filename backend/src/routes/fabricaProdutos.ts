import { Router, Request, Response } from "express";
import {
  listarProdutos,
  obterProduto,
  criarProduto,
  atualizarProduto,
  excluirProduto,
  type ProdutoEntrada,
  importarCatalogo,
  conferirPrecosCatalogo,
  aplicarPrecosCatalogo,
} from "../services/fabricaProdutosService";
import { exportarProdutos } from "../services/fabricaProdutosExportService";
import {
  listarEstoqueProdutos,
  definirEstoqueMinimoProduto,
  listarAjustesProduto,
  registrarAjusteProduto,
  registrarInventarioProduto,
  excluirAjusteProduto,
} from "../services/fabricaProdutoEstoqueService";

export const fabricaProdutosRouter = Router();

function erro(res: Response, err: unknown, padrao: string) {
  console.error("[fabrica-produtos]", err);
  const msg =
    err instanceof Error && /duplicate key/i.test(err.message)
      ? "Já existe um produto com esse SKU."
      : err instanceof Error && err.message
        ? err.message
        : padrao;
  res.status(400).json({ error: msg });
}

function lerEntrada(req: Request): ProdutoEntrada | string {
  const {
    sku, nome, formulaId, embalagemId, precoVenda, ativo, origem, ean, familia,
    custoCompra, tipo,
  } = req.body ?? {};
  if (typeof sku !== "string" || !sku.trim()) return "Informe o SKU.";
  if (typeof nome !== "string" || !nome.trim()) return "Informe o nome do produto.";
  const preco = Number(precoVenda);
  if (!Number.isFinite(preco) || preco < 0) return "Preço de venda inválido.";
  const revenda = origem === "DISTRIBUIDORA";
  const custo = Number(custoCompra);
  const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    sku: sku.trim(),
    nome: nome.trim(),
    origem: revenda ? "DISTRIBUIDORA" : "FABRICA",
    // insumo é o que a expedição consome — caixa, saco, fita. Só entra se vier
    // dito; o resto do catálogo é revenda.
    tipo: tipo === "INSUMO" || tipo === "CONSUMO_LOJA" ? tipo : "REVENDA",
    ean: texto(ean),
    familia: texto(familia),
    // custo digitado só existe na revenda: no produto de fábrica ele vem da
    // fórmula, e guardar um número ao lado criaria duas verdades
    custoCompra: revenda && Number.isFinite(custo) && custo >= 0 ? custo : null,
    formulaId: formulaId === null || formulaId === undefined ? null : Number(formulaId),
    embalagemId: embalagemId === null || embalagemId === undefined ? null : Number(embalagemId),
    precoVenda: preco,
    ativo: ativo !== false,
  };
}

fabricaProdutosRouter.get("/", async (_req, res) => {
  try {
    res.json({ produtos: await listarProdutos() });
  } catch (err) {
    erro(res, err, "Falha ao carregar produtos.");
  }
});

// --- estoque de produto acabado ---------------------------------------------
//
// Mesma tela, mesma permissão: quem cadastra o produto é quem conta o que tem
// na prateleira. O custo unitário vem do cálculo de produto que já existe, pra
// não repetir aqui a recursão de fórmula e rendimento.

async function custoPorProduto(): Promise<Map<number, number>> {
  const produtos = await listarProdutos();
  return new Map(produtos.map((p) => [p.id, p.custo]));
}

fabricaProdutosRouter.get("/estoque", async (_req, res) => {
  try {
    res.json({ estoque: await listarEstoqueProdutos(await custoPorProduto()) });
  } catch (err) {
    erro(res, err, "Falha ao carregar estoque de produtos.");
  }
});

fabricaProdutosRouter.put("/estoque/:id/minimo", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  const minimo = Number(req.body?.estoqueMinimo);
  if (!Number.isFinite(minimo) || minimo < 0) {
    return res.status(400).json({ error: "Estoque mínimo inválido." });
  }
  try {
    await definirEstoqueMinimoProduto(id, minimo);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao definir estoque mínimo.");
  }
});

fabricaProdutosRouter.get("/estoque/ajustes", async (_req, res) => {
  try {
    res.json({ ajustes: await listarAjustesProduto() });
  } catch (err) {
    erro(res, err, "Falha ao carregar ajustes.");
  }
});

fabricaProdutosRouter.post("/estoque/ajustes", async (req, res) => {
  const b = req.body ?? {};
  const produtoId = Number(b.produtoId);
  if (!Number.isInteger(produtoId)) return res.status(400).json({ error: "Escolha o produto." });
  const motivo = typeof b.motivo === "string" && b.motivo.trim() ? b.motivo.trim() : null;
  try {
    // inventário: o operador diz quanto TEM; ajuste: quanto entra ou sai
    if (b.tipo === "inventario") {
      const contado = Number(b.contado);
      if (!Number.isFinite(contado) || contado < 0) {
        return res.status(400).json({ error: "Quantidade contada inválida." });
      }
      return res
        .status(201)
        .json(await registrarInventarioProduto(produtoId, contado, motivo, await custoPorProduto()));
    }
    const quantidade = Number(b.quantidade);
    if (!Number.isFinite(quantidade) || quantidade === 0) {
      return res.status(400).json({ error: "Informe a quantidade (positiva entra, negativa sai)." });
    }
    res.status(201).json(await registrarAjusteProduto(produtoId, quantidade, motivo));
  } catch (err) {
    erro(res, err, "Falha ao registrar ajuste.");
  }
});

fabricaProdutosRouter.delete("/estoque/ajustes/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  try {
    await excluirAjusteProduto(id);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao excluir ajuste.");
  }
});

// antes de "/:id" de proposito: o Express casa na ordem, e depois dele
// "exportar" viraria um id invalido
fabricaProdutosRouter.get("/exportar", async (req, res) => {
  const origem =
    req.query.origem === "FABRICA" || req.query.origem === "DISTRIBUIDORA"
      ? req.query.origem
      : undefined;
  const somenteAtivos = req.query.ativos === "1";
  try {
    const buf = await exportarProdutos({ origem, somenteAtivos });
    const parte = origem ? (origem === "FABRICA" ? "-fabrica" : "-distribuicao") : "";
    const hoje = new Date()
      .toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
      .replace(/-/g, "");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="catalogo${parte}-${hoje}.xlsx"`
    );
    res.send(buf);
  } catch (err) {
    erro(res, err, "Falha ao exportar o catalogo.");
  }
});

fabricaProdutosRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  try {
    const produto = await obterProduto(id);
    if (!produto) return res.status(404).json({ error: "Produto não encontrado." });
    res.json(produto);
  } catch (err) {
    erro(res, err, "Falha ao buscar produto.");
  }
});

fabricaProdutosRouter.post("/", async (req, res) => {
  const entrada = lerEntrada(req);
  if (typeof entrada === "string") return res.status(400).json({ error: entrada });
  try {
    res.status(201).json(await criarProduto(entrada));
  } catch (err) {
    erro(res, err, "Falha ao criar produto.");
  }
});

fabricaProdutosRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  const entrada = lerEntrada(req);
  if (typeof entrada === "string") return res.status(400).json({ error: entrada });
  try {
    await atualizarProduto(id, entrada);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao atualizar produto.");
  }
});

fabricaProdutosRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  try {
    await excluirProduto(id);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao excluir produto.");
  }
});

// Traz os produtos de revenda do catálogo do Mercado Livre. Leitura pura: a
// planilha do Google Sheets não é tocada, e SKU que já existe aqui não é
// sobrescrito.
fabricaProdutosRouter.post("/importar-catalogo", async (_req, res) => {
  try {
    res.json(await importarCatalogo());
  } catch (err) {
    erro(res, err, "Falha ao importar o catálogo.");
  }
});

// O que mudou de preço na planilha desde a última vez. Só mostra — aplicar é
// outra chamada, porque preço de venda não pode mudar sem ninguém ver.
fabricaProdutosRouter.get("/conferir-precos", async (_req, res) => {
  try {
    res.json(await conferirPrecosCatalogo());
  } catch (err) {
    erro(res, err, "Falha ao conferir os preços.");
  }
});

fabricaProdutosRouter.post("/aplicar-precos", async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map(Number).filter(Number.isInteger)
    : [];
  try {
    res.json(await aplicarPrecosCatalogo(ids));
  } catch (err) {
    erro(res, err, "Falha ao aplicar os preços.");
  }
});
