import { Router, Response } from "express";
import {
  listarEmpacotadores,
  criarEmpacotador,
  atualizarEmpacotador,
  excluirEmpacotador,
  obterLancamentosDoDia,
  lancarPacotesDoDia,
  obterRankingMensal,
  obterHistoricoEmpacotador,
} from "../services/empacotadoresService";

export const empacotadoresRouter = Router();

const REGEX_DATA = /^\d{4}-\d{2}-\d{2}$/;

function erro(res: Response, err: unknown, fallback: string) {
  console.error(fallback, err);
  const mensagem = err instanceof Error ? err.message : fallback;
  res.status(400).json({ error: mensagem });
}

empacotadoresRouter.get("/", async (_req, res) => {
  try {
    res.json({ empacotadores: await listarEmpacotadores() });
  } catch (err) {
    erro(res, err, "Falha ao carregar empacotadores.");
  }
});

empacotadoresRouter.post("/", async (req, res) => {
  const { numero, nome } = req.body;
  if (!Number.isInteger(numero) || typeof nome !== "string" || !nome.trim()) {
    res.status(400).json({ error: "Informe o número e o nome do empacotador." });
    return;
  }
  try {
    res.json(await criarEmpacotador(numero, nome.trim()));
  } catch (err) {
    erro(res, err, "Falha ao criar empacotador.");
  }
});

empacotadoresRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { numero, nome } = req.body;
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  if (numero !== undefined && !Number.isInteger(numero)) {
    res.status(400).json({ error: "Número inválido." });
    return;
  }
  if (nome !== undefined && (typeof nome !== "string" || !nome.trim())) {
    res.status(400).json({ error: "Nome inválido." });
    return;
  }
  try {
    await atualizarEmpacotador(id, { numero, nome: nome?.trim() });
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao atualizar empacotador.");
  }
});

empacotadoresRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await excluirEmpacotador(id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao excluir empacotador.");
  }
});

empacotadoresRouter.get("/lancamentos", async (req, res) => {
  const data = String(req.query.data ?? "");
  if (!REGEX_DATA.test(data)) {
    res.status(400).json({ error: "Informe a data no formato YYYY-MM-DD." });
    return;
  }
  try {
    res.json({ lancamentos: await obterLancamentosDoDia(data) });
  } catch (err) {
    erro(res, err, "Falha ao carregar lançamentos do dia.");
  }
});

empacotadoresRouter.post("/lancamentos", async (req, res) => {
  const { data, itens } = req.body;
  if (!REGEX_DATA.test(data) || !Array.isArray(itens)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  const validos = itens.every(
    (item) => Number.isInteger(item?.empacotadorId) && Number.isInteger(item?.pacotes) && item.pacotes >= 0
  );
  if (!validos) {
    res.status(400).json({ error: "Lançamentos inválidos." });
    return;
  }
  try {
    await lancarPacotesDoDia(data, itens);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao salvar lançamentos.");
  }
});

empacotadoresRouter.get("/ranking", async (req, res) => {
  const ano = Number(req.query.ano);
  const mes = Number(req.query.mes);
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    res.status(400).json({ error: "Informe ano e mês válidos." });
    return;
  }
  try {
    res.json({ ranking: await obterRankingMensal(ano, mes) });
  } catch (err) {
    erro(res, err, "Falha ao carregar ranking.");
  }
});

empacotadoresRouter.get("/:id/historico", async (req, res) => {
  const id = Number(req.params.id);
  const ano = Number(req.query.ano);
  const mes = Number(req.query.mes);
  if (!Number.isInteger(id) || !Number.isInteger(ano) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    res.json({ historico: await obterHistoricoEmpacotador(id, ano, mes) });
  } catch (err) {
    erro(res, err, "Falha ao carregar histórico.");
  }
});
