import { Router, Request, Response } from "express";
import {
  listarFornecedores,
  fornecedoresNaoCadastrados,
  criarFornecedor,
  atualizarFornecedor,
  excluirFornecedor,
  type FornecedorEntrada,
} from "../services/fabricaFornecedoresService";

export const fabricaFornecedoresRouter = Router();

function erro(res: Response, err: unknown, padrao: string) {
  console.error("[fabrica-fornecedores]", err);
  res.status(400).json({ error: err instanceof Error && err.message ? err.message : padrao });
}

function lerEntrada(req: Request): FornecedorEntrada | string {
  const b = req.body ?? {};
  if (typeof b.nome !== "string" || !b.nome.trim()) return "Informe o nome do fornecedor.";
  const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    nome: b.nome.trim(),
    cnpj: texto(b.cnpj),
    email: texto(b.email),
    telefone: texto(b.telefone),
    cidade: texto(b.cidade),
    uf: texto(b.uf)?.toUpperCase().slice(0, 2) ?? null,
    categoriaPadrao: texto(b.categoriaPadrao),
    observacao: texto(b.observacao),
    ativo: b.ativo !== false,
  };
}

fabricaFornecedoresRouter.get("/", async (_req, res) => {
  try {
    res.json({ fornecedores: await listarFornecedores() });
  } catch (err) {
    erro(res, err, "Falha ao carregar os fornecedores.");
  }
});

// Quem aparece nas contas mas não está cadastrado — a lista de trabalho
fabricaFornecedoresRouter.get("/pendentes", async (_req, res) => {
  try {
    res.json({ pendentes: await fornecedoresNaoCadastrados() });
  } catch (err) {
    erro(res, err, "Falha ao levantar os fornecedores não cadastrados.");
  }
});

fabricaFornecedoresRouter.post("/", async (req, res) => {
  const e = lerEntrada(req);
  if (typeof e === "string") return res.status(400).json({ error: e });
  try {
    res.status(201).json(await criarFornecedor(e));
  } catch (err) {
    erro(res, err, "Falha ao cadastrar o fornecedor.");
  }
});

fabricaFornecedoresRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  const e = lerEntrada(req);
  if (typeof e === "string") return res.status(400).json({ error: e });
  try {
    await atualizarFornecedor(id, e);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao salvar o fornecedor.");
  }
});

fabricaFornecedoresRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  try {
    await excluirFornecedor(id);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao excluir o fornecedor.");
  }
});
