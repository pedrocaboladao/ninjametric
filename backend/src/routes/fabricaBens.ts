import { Router, Request, Response } from "express";
import {
  listarBens,
  criarBem,
  atualizarBem,
  excluirBem,
  type BemEntrada,
} from "../services/fabricaBensService";

export const fabricaBensRouter = Router();

function erro(res: Response, err: unknown, padrao: string) {
  console.error("[fabrica-bens]", err);
  res.status(400).json({ error: err instanceof Error && err.message ? err.message : padrao });
}

function lerEntrada(req: Request): BemEntrada | string {
  const b = req.body ?? {};
  if (typeof b.nome !== "string" || !b.nome.trim()) return "Informe o nome do bem.";
  const valor = Number(b.valor);
  if (!Number.isFinite(valor) || valor <= 0) return "Informe o valor de compra.";
  if (typeof b.dataCompra !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.dataCompra)) {
    return "Informe a data da compra.";
  }
  const vidaUtilAnos = Number(b.vidaUtilAnos);
  if (!Number.isFinite(vidaUtilAnos) || vidaUtilAnos <= 0) return "Informe a vida útil em anos.";

  return {
    nome: b.nome.trim(),
    tipo: b.tipo === "imovel" ? "imovel" : "movel",
    valor,
    dataCompra: b.dataCompra,
    vidaUtilAnos,
    observacao: typeof b.observacao === "string" && b.observacao.trim() ? b.observacao.trim() : null,
    ativo: b.ativo !== false,
  };
}

fabricaBensRouter.get("/", async (_req, res) => {
  try {
    res.json({ bens: await listarBens() });
  } catch (err) {
    erro(res, err, "Falha ao carregar os bens.");
  }
});

fabricaBensRouter.post("/", async (req, res) => {
  const e = lerEntrada(req);
  if (typeof e === "string") return res.status(400).json({ error: e });
  try {
    res.status(201).json(await criarBem(e));
  } catch (err) {
    erro(res, err, "Falha ao cadastrar o bem.");
  }
});

fabricaBensRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  const e = lerEntrada(req);
  if (typeof e === "string") return res.status(400).json({ error: e });
  try {
    await atualizarBem(id, e);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao salvar o bem.");
  }
});

fabricaBensRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  try {
    await excluirBem(id);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao excluir o bem.");
  }
});
