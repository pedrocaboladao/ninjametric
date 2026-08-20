import { Router, Request, Response } from "express";
import {
  listarProdutos,
  obterProduto,
  criarProduto,
  atualizarProduto,
  excluirProduto,
  type ProdutoEntrada,
} from "../services/fabricaProdutosService";

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
  const { sku, nome, formulaId, embalagemId, precoVenda, ativo } = req.body ?? {};
  if (typeof sku !== "string" || !sku.trim()) return "Informe o SKU.";
  if (typeof nome !== "string" || !nome.trim()) return "Informe o nome do produto.";
  const preco = Number(precoVenda);
  if (!Number.isFinite(preco) || preco < 0) return "Preço de venda inválido.";
  return {
    sku: sku.trim(),
    nome: nome.trim(),
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
