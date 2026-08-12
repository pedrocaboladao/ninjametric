import { Router, Request, Response } from "express";
import {
  listarMateriasPrimas,
  criarMateriaPrima,
  atualizarMateriaPrima,
  excluirMateriaPrima,
  listarComprasMateriaPrima,
  registrarCompraMateriaPrima,
  listarFormulas,
  obterFormula,
  criarFormula,
  atualizarFormula,
  excluirFormula,
  listarLotes,
  registrarLote,
  obterDadosMlPorSku,
  type ItemEntrada,
  type EmbalagemEntrada,
} from "../services/fabricacaoService";
import { temAcessoLoja, lojasEfetivas } from "../services/usuariosService";

export const fabricacaoRouter = Router();

function erro(res: Response, err: unknown, fallback: string) {
  console.error(fallback, err);
  const mensagem = err instanceof Error ? err.message : fallback;
  res.status(400).json({ error: mensagem });
}

function validarItens(valor: unknown): ItemEntrada[] | null {
  if (!Array.isArray(valor)) return null;
  const itens: ItemEntrada[] = [];
  for (const item of valor) {
    const materiaPrimaId = item?.materiaPrimaId === null || item?.materiaPrimaId === undefined ? null : Number(item.materiaPrimaId);
    const subFormulaId = item?.subFormulaId === null || item?.subFormulaId === undefined ? null : Number(item.subFormulaId);
    const percentual = Number(item?.percentual);
    const umTipo =
      (materiaPrimaId !== null && subFormulaId === null) || (materiaPrimaId === null && subFormulaId !== null);
    if (!umTipo) return null;
    if (materiaPrimaId !== null && !Number.isInteger(materiaPrimaId)) return null;
    if (subFormulaId !== null && !Number.isInteger(subFormulaId)) return null;
    if (!Number.isFinite(percentual) || percentual < 0) return null;
    itens.push({ materiaPrimaId, subFormulaId, percentual });
  }
  return itens;
}

function validarEmbalagens(valor: unknown): EmbalagemEntrada[] | null {
  if (!Array.isArray(valor)) return null;
  const embalagens: EmbalagemEntrada[] = [];
  for (const e of valor) {
    const nome = typeof e?.nome === "string" ? e.nome.trim() : "";
    const pesoKg = Number(e?.pesoKg);
    const custoEmbalagem = Number(e?.custoEmbalagem);
    const sku = typeof e?.sku === "string" && e.sku.trim() ? e.sku.trim() : null;
    if (!nome || !Number.isFinite(pesoKg) || pesoKg <= 0 || !Number.isFinite(custoEmbalagem) || custoEmbalagem < 0) {
      return null;
    }
    embalagens.push({ nome, pesoKg, custoEmbalagem, sku });
  }
  return embalagens;
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

fabricacaoRouter.get("/materias-primas/:id/compras", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    res.json({ compras: await listarComprasMateriaPrima(id) });
  } catch (err) {
    erro(res, err, "Falha ao carregar compras.");
  }
});

fabricacaoRouter.post("/materias-primas/:id/compras", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  const { data, quantidadeKg, valorPago, valorFrete } = req.body ?? {};
  const quantidade = Number(quantidadeKg);
  const pago = Number(valorPago);
  const frete = Number(valorFrete ?? 0);
  if (typeof data !== "string" || !data.trim()) {
    res.status(400).json({ error: "Informe a data da compra." });
    return;
  }
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    res.status(400).json({ error: "Quantidade (kg) inválida." });
    return;
  }
  if (!Number.isFinite(pago) || pago < 0) {
    res.status(400).json({ error: "Valor pago inválido." });
    return;
  }
  if (!Number.isFinite(frete) || frete < 0) {
    res.status(400).json({ error: "Valor de frete inválido." });
    return;
  }
  try {
    res.json(await registrarCompraMateriaPrima(id, data, quantidade, pago, frete));
  } catch (err) {
    erro(res, err, "Falha ao registrar compra.");
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
  const { nome, pesoLoteKg, itens, embalagens } = req.body ?? {};
  if (typeof nome !== "string" || !nome.trim()) {
    res.status(400).json({ error: "Informe o nome da fórmula." });
    return;
  }
  const peso = Number(pesoLoteKg);
  if (!Number.isFinite(peso) || peso <= 0) {
    res.status(400).json({ error: "Peso do lote inválido." });
    return;
  }
  const itensValidados = validarItens(itens);
  if (itensValidados === null) {
    res.status(400).json({ error: "Itens da fórmula inválidos." });
    return;
  }
  const embalagensValidadas = validarEmbalagens(embalagens ?? []);
  if (embalagensValidadas === null) {
    res.status(400).json({ error: "Tamanhos de envase inválidos." });
    return;
  }
  try {
    const id = await criarFormula(nome.trim(), peso, itensValidados, embalagensValidadas);
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
  const { nome, pesoLoteKg, itens, embalagens } = req.body ?? {};
  if (typeof nome !== "string" || !nome.trim()) {
    res.status(400).json({ error: "Informe o nome da fórmula." });
    return;
  }
  const peso = Number(pesoLoteKg);
  if (!Number.isFinite(peso) || peso <= 0) {
    res.status(400).json({ error: "Peso do lote inválido." });
    return;
  }
  const itensValidados = validarItens(itens);
  if (itensValidados === null) {
    res.status(400).json({ error: "Itens da fórmula inválidos." });
    return;
  }
  const embalagensValidadas = validarEmbalagens(embalagens ?? []);
  if (embalagensValidadas === null) {
    res.status(400).json({ error: "Tamanhos de envase inválidos." });
    return;
  }
  try {
    await atualizarFormula(id, nome.trim(), peso, itensValidados, embalagensValidadas);
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
    erro(res, err, "Não foi possível excluir — confira se essa fórmula está sendo usada como ingrediente de outra.");
  }
});

fabricacaoRouter.get("/formulas/:id/lotes", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    res.json({ lotes: await listarLotes(id) });
  } catch (err) {
    erro(res, err, "Falha ao carregar lotes de produção.");
  }
});

fabricacaoRouter.post("/formulas/:id/lotes", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  const { data, pesoRealKg, observacao } = req.body ?? {};
  const peso = Number(pesoRealKg);
  if (typeof data !== "string" || !data.trim()) {
    res.status(400).json({ error: "Informe a data do lote." });
    return;
  }
  if (!Number.isFinite(peso) || peso <= 0) {
    res.status(400).json({ error: "Peso real inválido." });
    return;
  }
  try {
    res.json(
      await registrarLote(id, data, peso, typeof observacao === "string" && observacao.trim() ? observacao.trim() : null)
    );
  } catch (err) {
    erro(res, err, "Falha ao registrar lote.");
  }
});

fabricacaoRouter.get("/formulas/:id/dados-ml", async (req, res) => {
  const id = Number(req.params.id);
  const sku = req.query.sku;
  if (!Number.isInteger(id) || typeof sku !== "string" || !sku.trim()) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;

  try {
    res.json(await obterDadosMlPorSku(sku.trim(), filtro.lojaId, filtro.lojasPermitidas));
  } catch (err) {
    erro(res, err, "Falha ao buscar dados do Mercado Livre.");
  }
});
