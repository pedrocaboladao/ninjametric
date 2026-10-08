import { Router, Response, Request } from "express";
import multer from "multer";
import {
  listarQuadro,
  criarColuna,
  renomearColuna,
  excluirColuna,
  criarCard,
  atualizarCard,
  moverCard,
  excluirCard,
  listarAnexosDoCard,
  salvarAnexoDoCard,
  lerAnexoDoCard,
  apagarAnexoDoCard,
  definirCapaDoCard,
  clonarCard,
} from "../services/agendaQuadroService";

const uploadAnexo = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
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
  listarAvisos,
  criarAviso,
  excluirAviso,
  contarAvisosNaoVistos,
  marcarMuralVisto,
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

agendaRouter.get("/quadro", async (_req, res) => {
  try {
    res.json({ colunas: await listarQuadro() });
  } catch (err) {
    erro(res, err, "Falha ao carregar o quadro.");
  }
});

agendaRouter.post("/quadro/colunas", async (req, res) => {
  const { nome } = req.body ?? {};
  if (typeof nome !== "string" || !nome.trim()) {
    res.status(400).json({ error: "Informe o nome da coluna." });
    return;
  }
  try {
    await criarColuna(nome.trim());
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao criar coluna.");
  }
});

agendaRouter.patch("/quadro/colunas/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { nome } = req.body ?? {};
  if (!Number.isInteger(id) || typeof nome !== "string" || !nome.trim()) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await renomearColuna(id, nome.trim());
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao renomear coluna.");
  }
});

agendaRouter.delete("/quadro/colunas/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await excluirColuna(id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao excluir coluna.");
  }
});

agendaRouter.post("/quadro/cards", async (req, res) => {
  const { colunaId, titulo, descricao, atribuidoAUsuarioId, lojaId } = req.body ?? {};
  if (!Number.isInteger(colunaId) || typeof titulo !== "string" || !titulo.trim()) {
    res.status(400).json({ error: "Informe a coluna e o título do card." });
    return;
  }
  try {
    await criarCard(req.usuario!.id, colunaId, {
      titulo: titulo.trim(),
      descricao: typeof descricao === "string" && descricao.trim() ? descricao.trim() : null,
      atribuidoAUsuarioId: Number.isInteger(atribuidoAUsuarioId) ? atribuidoAUsuarioId : null,
      lojaId: Number.isInteger(lojaId) ? lojaId : null,
    });
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao criar card.");
  }
});

agendaRouter.patch("/quadro/cards/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { titulo, descricao, atribuidoAUsuarioId, lojaId, concluido } = req.body ?? {};
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  if (titulo !== undefined && (typeof titulo !== "string" || !titulo.trim())) {
    res.status(400).json({ error: "Título inválido." });
    return;
  }
  if (concluido !== undefined && typeof concluido !== "boolean") {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await atualizarCard(id, {
      titulo: titulo !== undefined ? titulo.trim() : undefined,
      descricao: descricao !== undefined ? (typeof descricao === "string" && descricao.trim() ? descricao.trim() : null) : undefined,
      atribuidoAUsuarioId: atribuidoAUsuarioId !== undefined ? (Number.isInteger(atribuidoAUsuarioId) ? atribuidoAUsuarioId : null) : undefined,
      lojaId: lojaId !== undefined ? (Number.isInteger(lojaId) ? lojaId : null) : undefined,
      concluido,
    });
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao atualizar card.");
  }
});

agendaRouter.post("/quadro/cards/:id/mover", async (req, res) => {
  const id = Number(req.params.id);
  const { colunaId } = req.body ?? {};
  if (!Number.isInteger(id) || !Number.isInteger(colunaId)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await moverCard(id, colunaId);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao mover card.");
  }
});

agendaRouter.delete("/quadro/cards/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await excluirCard(id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao excluir card.");
  }
});


agendaRouter.get("/quadro/cards/:id/anexos", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    res.json({ anexos: await listarAnexosDoCard(id) });
  } catch (err) {
    erro(res, err, "Falha ao listar anexos do card.");
  }
});

agendaRouter.post("/quadro/cards/:id/anexos", uploadAnexo.single("arquivo"), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "Envie o arquivo." });
    return;
  }
  try {
    await salvarAnexoDoCard(id, req.file.originalname || "anexo", req.file.mimetype || "application/octet-stream", req.file.buffer);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao anexar o arquivo.");
  }
});

agendaRouter.get("/quadro/anexos/:anexoId", async (req, res) => {
  const id = Number(req.params.anexoId);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    const anexo = await lerAnexoDoCard(id);
    if (!anexo) {
      res.status(404).json({ error: "Anexo não encontrado." });
      return;
    }
    res.setHeader("Content-Type", anexo.tipo || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${anexo.nome.replace(/[^w.-]/g, "_")}"`);
    res.send(anexo.conteudo);
  } catch (err) {
    erro(res, err, "Falha ao abrir o anexo.");
  }
});

agendaRouter.delete("/quadro/anexos/:anexoId", async (req, res) => {
  const id = Number(req.params.anexoId);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await apagarAnexoDoCard(id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao apagar o anexo.");
  }
});

agendaRouter.post("/quadro/anexos/:anexoId/capa", async (req, res) => {
  const id = Number(req.params.anexoId);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await definirCapaDoCard(id, true);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao definir a capa.");
  }
});

agendaRouter.delete("/quadro/anexos/:anexoId/capa", async (req, res) => {
  const id = Number(req.params.anexoId);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await definirCapaDoCard(id, false);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao remover a capa.");
  }
});

agendaRouter.post("/quadro/cards/:id/clonar", async (req, res) => {
  const id = Number(req.params.id);
  const { colunaId } = req.body ?? {};
  if (!Number.isInteger(id) || !Number.isInteger(colunaId)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await clonarCard(id, colunaId, req.usuario!.id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao clonar card.");
  }
});

agendaRouter.get("/avisos", async (req, res) => {
  try {
    res.json({ avisos: await listarAvisos(req.usuario!.id) });
  } catch (err) {
    erro(res, err, "Falha ao carregar os avisos.");
  }
});

agendaRouter.get("/mural/nao-vistos", async (req, res) => {
  try {
    res.json({ total: await contarAvisosNaoVistos(req.usuario!.id) });
  } catch (err) {
    erro(res, err, "Falha ao contar avisos não vistos.");
  }
});

agendaRouter.post("/mural/visto", async (req, res) => {
  try {
    await marcarMuralVisto(req.usuario!.id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao marcar o mural como visto.");
  }
});

agendaRouter.post("/avisos", async (req, res) => {
  const texto = typeof req.body?.texto === "string" ? req.body.texto.trim() : "";
  if (!texto) {
    res.status(400).json({ error: "Escreva o aviso." });
    return;
  }
  try {
    await criarAviso(req.usuario!.id, texto);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao publicar o aviso.");
  }
});

agendaRouter.delete("/avisos/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await excluirAviso(id, req.usuario!.id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao excluir o aviso.");
  }
});
