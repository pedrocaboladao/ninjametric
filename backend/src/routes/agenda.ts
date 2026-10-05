import { Router, Response } from "express";
import {
  listarTarefas,
  criarTarefa,
  atualizarTarefa,
  excluirTarefa,
  obterSemanaAtual,
  marcarOcorrenciaFeita,
  desmarcarOcorrencia,
  contarPendentes,
  listarUsuariosParaAtribuir,
  listarLojasParaAgenda,
  listarRelatorios,
  criarRelatorio,
  excluirRelatorio,
  listarPromocoesDasLojas,
} from "../services/agendaService";

const REGEX_DATA = /^\d{4}-\d{2}-\d{2}$/;

export const agendaRouter = Router();

function erro(res: Response, err: unknown, fallback: string) {
  console.error(fallback, err);
  const mensagem = err instanceof Error ? err.message : fallback;
  res.status(400).json({ error: mensagem });
}

agendaRouter.get("/semana", async (_req, res) => {
  try {
    res.json(await obterSemanaAtual());
  } catch (err) {
    erro(res, err, "Falha ao carregar a semana da agenda.");
  }
});

agendaRouter.get("/tarefas", async (_req, res) => {
  try {
    res.json({ tarefas: await listarTarefas() });
  } catch (err) {
    erro(res, err, "Falha ao listar tarefas da agenda.");
  }
});

agendaRouter.get("/usuarios", async (_req, res) => {
  try {
    res.json({ usuarios: await listarUsuariosParaAtribuir() });
  } catch (err) {
    erro(res, err, "Falha ao listar usuários.");
  }
});

agendaRouter.get("/lojas", async (_req, res) => {
  try {
    res.json({ lojas: await listarLojasParaAgenda() });
  } catch (err) {
    erro(res, err, "Falha ao listar lojas.");
  }
});

agendaRouter.get("/promocoes", async (_req, res) => {
  try {
    res.json({ promocoes: await listarPromocoesDasLojas() });
  } catch (err) {
    erro(res, err, "Falha ao carregar as promoções das lojas.");
  }
});

agendaRouter.get("/pendentes", async (req, res) => {
  try {
    res.json({ total: await contarPendentes(req.usuario!.id) });
  } catch (err) {
    erro(res, err, "Falha ao contar pendências da agenda.");
  }
});

agendaRouter.post("/tarefas", async (req, res) => {
  const { titulo, descricao, intervaloDias, dataInicio, atribuidoAUsuarioId, lojaId } = req.body;
  if (typeof titulo !== "string" || !titulo.trim()) {
    res.status(400).json({ error: "Informe o título da tarefa." });
    return;
  }
  if (!Number.isInteger(intervaloDias) || intervaloDias <= 0) {
    res.status(400).json({ error: "Informe o intervalo em dias (número inteiro maior que zero)." });
    return;
  }
  if (typeof dataInicio !== "string" || !REGEX_DATA.test(dataInicio)) {
    res.status(400).json({ error: "Informe a data de início no formato AAAA-MM-DD." });
    return;
  }
  if (atribuidoAUsuarioId !== undefined && atribuidoAUsuarioId !== null && !Number.isInteger(atribuidoAUsuarioId)) {
    res.status(400).json({ error: "atribuidoAUsuarioId inválido." });
    return;
  }
  if (lojaId !== undefined && lojaId !== null && !Number.isInteger(lojaId)) {
    res.status(400).json({ error: "lojaId inválido." });
    return;
  }
  try {
    const tarefa = await criarTarefa(req.usuario!.id, {
      titulo: titulo.trim(),
      descricao: typeof descricao === "string" && descricao.trim() ? descricao.trim() : null,
      intervaloDias,
      dataInicio,
      atribuidoAUsuarioId: atribuidoAUsuarioId ?? null,
      lojaId: lojaId ?? null,
    });
    res.json(tarefa);
  } catch (err) {
    erro(res, err, "Falha ao criar tarefa da agenda.");
  }
});

agendaRouter.patch("/tarefas/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  const { titulo, descricao, intervaloDias, dataInicio, atribuidoAUsuarioId, lojaId, ativo } = req.body ?? {};
  if (titulo !== undefined && (typeof titulo !== "string" || !titulo.trim())) {
    res.status(400).json({ error: "Título inválido." });
    return;
  }
  if (intervaloDias !== undefined && (!Number.isInteger(intervaloDias) || intervaloDias <= 0)) {
    res.status(400).json({ error: "Intervalo em dias inválido." });
    return;
  }
  if (dataInicio !== undefined && (typeof dataInicio !== "string" || !REGEX_DATA.test(dataInicio))) {
    res.status(400).json({ error: "Data de início inválida." });
    return;
  }
  if (lojaId !== undefined && lojaId !== null && !Number.isInteger(lojaId)) {
    res.status(400).json({ error: "lojaId inválido." });
    return;
  }
  try {
    await atualizarTarefa(id, {
      titulo: titulo !== undefined ? titulo.trim() : undefined,
      descricao: descricao !== undefined ? (descricao?.trim() || null) : undefined,
      intervaloDias,
      dataInicio,
      atribuidoAUsuarioId,
      lojaId,
      ativo,
    });
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao atualizar tarefa da agenda.");
  }
});

agendaRouter.delete("/tarefas/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await excluirTarefa(id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao excluir tarefa da agenda.");
  }
});

agendaRouter.post("/tarefas/:id/ocorrencias/:data", async (req, res) => {
  const id = Number(req.params.id);
  const { data } = req.params;
  if (!Number.isInteger(id) || !REGEX_DATA.test(data)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await marcarOcorrenciaFeita(id, data, req.usuario!.id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao marcar ocorrência como feita.");
  }
});

agendaRouter.get("/relatorios", async (_req, res) => {
  try {
    res.json({ relatorios: await listarRelatorios() });
  } catch (err) {
    erro(res, err, "Falha ao carregar o relatório.");
  }
});

agendaRouter.post("/relatorios", async (req, res) => {
  const { sku, link, texto, lojaId } = req.body ?? {};
  if (typeof sku !== "string" || !sku.trim()) {
    res.status(400).json({ error: "Informe o SKU." });
    return;
  }
  if (typeof link !== "string" || !link.trim()) {
    res.status(400).json({ error: "Informe o link do anúncio." });
    return;
  }
  if (lojaId !== undefined && lojaId !== null && !Number.isInteger(lojaId)) {
    res.status(400).json({ error: "lojaId inválido." });
    return;
  }
  try {
    const relatorio = await criarRelatorio(req.usuario!.id, {
      sku: sku.trim(),
      link: link.trim(),
      texto: typeof texto === "string" && texto.trim() ? texto.trim() : null,
      lojaId: lojaId ?? null,
    });
    res.json(relatorio);
  } catch (err) {
    erro(res, err, "Falha ao adicionar ao relatório.");
  }
});

agendaRouter.delete("/relatorios/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await excluirRelatorio(id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao excluir entrada do relatório.");
  }
});

agendaRouter.delete("/tarefas/:id/ocorrencias/:data", async (req, res) => {
  const id = Number(req.params.id);
  const { data } = req.params;
  if (!Number.isInteger(id) || !REGEX_DATA.test(data)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await desmarcarOcorrencia(id, data);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao desmarcar ocorrência.");
  }
});
