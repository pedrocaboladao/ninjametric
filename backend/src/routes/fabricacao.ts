import { Router, Request, Response } from "express";
import {
  listarMateriasPrimas,
  criarMateriaPrima,
  atualizarMateriaPrima,
  excluirMateriaPrima,
  listarFormulas,
  obterFormula,
  criarFormula,
  atualizarFormula,
  excluirFormula,
  obterDadosMlPorSku,
} from "../services/fabricacaoService";
import { temAcessoLoja, lojasEfetivas } from "../services/usuariosService";

export const fabricacaoRouter = Router();

function erro(res: Response, err: unknown, fallback: string) {
  console.error(fallback, err);
  const mensagem = err instanceof Error ? err.message : fallback;
  res.status(400).json({ error: mensagem });
}

interface ItemEntrada {
  materiaPrimaId: number;
  percentual: number;
}

function validarItens(valor: unknown): ItemEntrada[] | null {
  if (!Array.isArray(valor)) return null;
  const itens: ItemEntrada[] = [];
  for (const item of valor) {
    const materiaPrimaId = Number(item?.materiaPrimaId);
    const percentual = Number(item?.percentual);
    if (!Number.isInteger(materiaPrimaId) || !Number.isFinite(percentual) || percentual < 0) return null;
    itens.push({ materiaPrimaId, percentual });
  }
  return itens;
}

// Mesmo padrão duplicado por arquivo do resto do sistema (ver financeiro.ts,
// ads.ts, correcoes.ts) — usado só na rota de dados-ml, que precisa saber
// quais lojas o usuário pode ver pra puxar a venda real certa.
function resolverLojaFiltro(req: Request, res: Response): { lojaId?: number; lojasPermitidas?: number[] } | null {
  const lojaIdParam = req.query.lojaId;
  const usuario = req.usuario!;

  if (lojaIdParam === "minhas") {
    return { lojaId: undefined, lojasPermitidas: usuario.lojas };
  }

  const lojaId =
    typeof lojaIdParam === "string" && Number.isInteger(Number(lojaIdParam)) ? Number(lojaIdParam) : undefined;

  if (lojaId !== undefined && !temAcessoLoja(usuario, lojaId)) {
    res.status(403).json({ error: "Você não tem acesso a essa loja." });
    return null;
  }

  return { lojaId, lojasPermitidas: lojasEfetivas(usuario) };
}

fabricacaoRouter.get("/materias-primas", async (_req, res) => {
  try {
    res.json({ materiasPrimas: await listarMateriasPrimas() });
  } catch (err) {
    erro(res, err, "Falha ao carregar matérias-primas.");
  }
});

fabricacaoRouter.post("/materias-primas", async (req, res) => {
  const { nome, custoPorKg } = req.body ?? {};
  if (typeof nome !== "string" || !nome.trim()) {
    res.status(400).json({ error: "Informe o nome da matéria-prima." });
    return;
  }
  const custo = Number(custoPorKg);
  if (!Number.isFinite(custo) || custo < 0) {
    res.status(400).json({ error: "Custo por kg inválido." });
    return;
  }
  try {
    res.json(await criarMateriaPrima(nome.trim(), custo));
  } catch (err) {
    erro(res, err, "Falha ao criar matéria-prima — já existe uma com esse nome?");
  }
});

fabricacaoRouter.put("/materias-primas/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  const { nome, custoPorKg } = req.body ?? {};
  if (typeof nome !== "string" || !nome.trim()) {
    res.status(400).json({ error: "Informe o nome da matéria-prima." });
    return;
  }
  const custo = Number(custoPorKg);
  if (!Number.isFinite(custo) || custo < 0) {
    res.status(400).json({ error: "Custo por kg inválido." });
    return;
  }
  try {
    await atualizarMateriaPrima(id, nome.trim(), custo);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao atualizar matéria-prima.");
  }
});

fabricacaoRouter.delete("/materias-primas/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await excluirMateriaPrima(id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Não foi possível excluir — essa matéria-prima está em uso em alguma fórmula.");
  }
});

fabricacaoRouter.get("/formulas", async (_req, res) => {
  try {
    res.json({ formulas: await listarFormulas() });
  } catch (err) {
    erro(res, err, "Falha ao carregar fórmulas.");
  }
});

fabricacaoRouter.get("/formulas/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    const formula = await obterFormula(id);
    if (!formula) {
      res.status(404).json({ error: "Fórmula não encontrada." });
      return;
    }
    res.json(formula);
  } catch (err) {
    erro(res, err, "Falha ao carregar fórmula.");
  }
});

fabricacaoRouter.post("/formulas", async (req, res) => {
  const { nome, sku, pesoLoteKg, custoEmbalagem, itens } = req.body ?? {};
  if (typeof nome !== "string" || !nome.trim()) {
    res.status(400).json({ error: "Informe o nome da fórmula." });
    return;
  }
  const peso = Number(pesoLoteKg);
  const embalagem = Number(custoEmbalagem);
  if (!Number.isFinite(peso) || peso <= 0) {
    res.status(400).json({ error: "Peso do lote inválido." });
    return;
  }
  if (!Number.isFinite(embalagem) || embalagem < 0) {
    res.status(400).json({ error: "Custo de embalagem inválido." });
    return;
  }
  const itensValidados = validarItens(itens);
  if (itensValidados === null) {
    res.status(400).json({ error: "Itens da fórmula inválidos." });
    return;
  }
  try {
    const id = await criarFormula(
      nome.trim(),
      typeof sku === "string" && sku.trim() ? sku.trim() : null,
      peso,
      embalagem,
      itensValidados
    );
    res.json({ id });
  } catch (err) {
    erro(res, err, "Falha ao criar fórmula.");
  }
});

fabricacaoRouter.put("/formulas/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  const { nome, sku, pesoLoteKg, custoEmbalagem, itens } = req.body ?? {};
  if (typeof nome !== "string" || !nome.trim()) {
    res.status(400).json({ error: "Informe o nome da fórmula." });
    return;
  }
  const peso = Number(pesoLoteKg);
  const embalagem = Number(custoEmbalagem);
  if (!Number.isFinite(peso) || peso <= 0) {
    res.status(400).json({ error: "Peso do lote inválido." });
    return;
  }
  if (!Number.isFinite(embalagem) || embalagem < 0) {
    res.status(400).json({ error: "Custo de embalagem inválido." });
    return;
  }
  const itensValidados = validarItens(itens);
  if (itensValidados === null) {
    res.status(400).json({ error: "Itens da fórmula inválidos." });
    return;
  }
  try {
    await atualizarFormula(
      id,
      nome.trim(),
      typeof sku === "string" && sku.trim() ? sku.trim() : null,
      peso,
      embalagem,
      itensValidados
    );
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao atualizar fórmula.");
  }
});

fabricacaoRouter.delete("/formulas/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await excluirFormula(id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao excluir fórmula.");
  }
});

fabricacaoRouter.get("/formulas/:id/dados-ml", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;

  try {
    const formula = await obterFormula(id);
    if (!formula) {
      res.status(404).json({ error: "Fórmula não encontrada." });
      return;
    }
    if (!formula.sku) {
      res.status(400).json({ error: "Essa fórmula não tem SKU vinculado." });
      return;
    }
    res.json(await obterDadosMlPorSku(formula.sku, filtro.lojaId, filtro.lojasPermitidas));
  } catch (err) {
    erro(res, err, "Falha ao buscar dados do Mercado Livre.");
  }
});
