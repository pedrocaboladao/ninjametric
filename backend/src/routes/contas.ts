import { Router, Request, Response } from "express";
import {
  listarLancamentos,
  criarLancamento,
  criarLancamentoParcelado,
  atualizarLancamento,
  marcarComoPago,
  excluirLancamento,
  calcularResumo,
  obterLojaDoLancamento,
  type TipoLancamento,
  type StatusLancamento,
} from "../services/contasService";
import {
  listarContatos,
  criarContato,
  atualizarContato,
  excluirContato,
  type TipoContato,
} from "../services/contasContatosService";
import { temAcessoLoja, lojasEfetivas } from "../services/usuariosService";

export const contasRouter = Router();

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIPOS_VALIDOS = new Set(["pagar", "receber"]);
const STATUS_VALIDOS = new Set(["pendente", "pago", "cancelado"]);
const TIPOS_CONTATO_VALIDOS = new Set(["fornecedor", "cliente"]);

function erro(res: Response, err: unknown, fallback: string) {
  console.error(fallback, err);
  const mensagem = err instanceof Error ? err.message : fallback;
  res.status(400).json({ error: mensagem });
}

// Mesmo padrão de dashboard.ts/financeiro.ts/ads.ts.
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

function extrairDatas(req: Request): { dataInicio?: string; dataFim?: string } {
  const { dataInicio, dataFim } = req.query;
  if (typeof dataInicio === "string" && typeof dataFim === "string" && DATA_REGEX.test(dataInicio) && DATA_REGEX.test(dataFim)) {
    return { dataInicio, dataFim };
  }
  return {};
}

function extrairTipoStatus(req: Request): { tipo?: TipoLancamento; status?: StatusLancamento } {
  const { tipo, status } = req.query;
  return {
    tipo: typeof tipo === "string" && TIPOS_VALIDOS.has(tipo) ? (tipo as TipoLancamento) : undefined,
    status: typeof status === "string" && STATUS_VALIDOS.has(status) ? (status as StatusLancamento) : undefined,
  };
}

// Garante que o usuário tem acesso à loja do lançamento antes de mutar —
// resolverLojaFiltro só protege o filtro de listagem; PATCH/DELETE/
// marcar-pago recebem o id direto, que pode pertencer a uma loja fora do
// acesso do usuário.
async function garantirAcessoAoLancamento(req: Request, res: Response, id: number): Promise<boolean> {
  const lojaId = await obterLojaDoLancamento(id);
  if (lojaId === null) {
    res.status(404).json({ error: "Lançamento não encontrado." });
    return false;
  }
  if (!temAcessoLoja(req.usuario!, lojaId)) {
    res.status(403).json({ error: "Você não tem acesso a essa loja." });
    return false;
  }
  return true;
}

contasRouter.get("/", async (req, res) => {
  const filtroLoja = resolverLojaFiltro(req, res);
  if (!filtroLoja) return;
  const { dataInicio, dataFim } = extrairDatas(req);
  const { tipo, status } = extrairTipoStatus(req);
  try {
    res.json(await listarLancamentos({ ...filtroLoja, tipo, status, dataInicio, dataFim }));
  } catch (err) {
    erro(res, err, "Falha ao carregar lançamentos.");
  }
});

contasRouter.get("/resumo", async (req, res) => {
  const filtroLoja = resolverLojaFiltro(req, res);
  if (!filtroLoja) return;
  const { dataInicio, dataFim } = extrairDatas(req);
  try {
    res.json(await calcularResumo({ ...filtroLoja, dataInicio, dataFim }));
  } catch (err) {
    erro(res, err, "Falha ao calcular resumo.");
  }
});

function extrairContatoId(body: Record<string, unknown>): number | null | undefined {
  const { contatoId } = body;
  if (contatoId === undefined) return undefined;
  if (contatoId === null) return null;
  return Number.isInteger(contatoId) ? (contatoId as number) : undefined;
}

contasRouter.post("/", async (req, res) => {
  const { lojaId, tipo, descricao, categoria, valor, vencimento, observacao } = req.body ?? {};
  const usuario = req.usuario!;

  if (!Number.isInteger(lojaId) || !temAcessoLoja(usuario, lojaId)) {
    res.status(403).json({ error: "Você não tem acesso a essa loja." });
    return;
  }
  if (typeof tipo !== "string" || !TIPOS_VALIDOS.has(tipo)) {
    res.status(400).json({ error: "Informe o tipo (pagar ou receber)." });
    return;
  }
  if (typeof descricao !== "string" || !descricao.trim()) {
    res.status(400).json({ error: "Informe a descrição." });
    return;
  }
  if (typeof valor !== "number" || !(valor > 0)) {
    res.status(400).json({ error: "Informe um valor maior que zero." });
    return;
  }
  if (typeof vencimento !== "string" || !DATA_REGEX.test(vencimento)) {
    res.status(400).json({ error: "Informe a data de vencimento." });
    return;
  }

  try {
    res.json(
      await criarLancamento(usuario.id, {
        lojaId,
        tipo: tipo as TipoLancamento,
        descricao: descricao.trim(),
        categoria: typeof categoria === "string" && categoria.trim() ? categoria.trim() : null,
        contatoId: extrairContatoId(req.body ?? {}),
        valor,
        vencimento,
        observacao: typeof observacao === "string" && observacao.trim() ? observacao.trim() : null,
      })
    );
  } catch (err) {
    erro(res, err, "Falha ao criar lançamento.");
  }
});

contasRouter.post("/parcelado", async (req, res) => {
  const { lojaId, tipo, descricao, categoria, valorParcela, primeiroVencimento, quantidadeParcelas, observacao } =
    req.body ?? {};
  const usuario = req.usuario!;

  if (!Number.isInteger(lojaId) || !temAcessoLoja(usuario, lojaId)) {
    res.status(403).json({ error: "Você não tem acesso a essa loja." });
    return;
  }
  if (typeof tipo !== "string" || !TIPOS_VALIDOS.has(tipo)) {
    res.status(400).json({ error: "Informe o tipo (pagar ou receber)." });
    return;
  }
  if (typeof descricao !== "string" || !descricao.trim()) {
    res.status(400).json({ error: "Informe a descrição." });
    return;
  }
  if (typeof valorParcela !== "number" || !(valorParcela > 0)) {
    res.status(400).json({ error: "Informe um valor de parcela maior que zero." });
    return;
  }
  if (typeof primeiroVencimento !== "string" || !DATA_REGEX.test(primeiroVencimento)) {
    res.status(400).json({ error: "Informe o vencimento da 1ª parcela." });
    return;
  }
  if (!Number.isInteger(quantidadeParcelas) || quantidadeParcelas < 2 || quantidadeParcelas > 60) {
    res.status(400).json({ error: "Informe uma quantidade de parcelas entre 2 e 60." });
    return;
  }

  try {
    const parcelas = await criarLancamentoParcelado(usuario.id, {
      lojaId,
      tipo: tipo as TipoLancamento,
      descricao: descricao.trim(),
      categoria: typeof categoria === "string" && categoria.trim() ? categoria.trim() : null,
      contatoId: extrairContatoId(req.body ?? {}),
      valorParcela,
      primeiroVencimento,
      quantidadeParcelas,
      observacao: typeof observacao === "string" && observacao.trim() ? observacao.trim() : null,
    });
    res.json(parcelas);
  } catch (err) {
    erro(res, err, "Falha ao criar lançamento parcelado.");
  }
});

contasRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  if (!(await garantirAcessoAoLancamento(req, res, id))) return;

  const { descricao, categoria, valor, vencimento, observacao, status, dataPagamento } = req.body ?? {};

  if (valor !== undefined && !(typeof valor === "number" && valor > 0)) {
    res.status(400).json({ error: "Valor inválido." });
    return;
  }
  if (vencimento !== undefined && (typeof vencimento !== "string" || !DATA_REGEX.test(vencimento))) {
    res.status(400).json({ error: "Vencimento inválido." });
    return;
  }
  if (status !== undefined && (typeof status !== "string" || !STATUS_VALIDOS.has(status))) {
    res.status(400).json({ error: "Status inválido." });
    return;
  }
  if (dataPagamento !== undefined && dataPagamento !== null && (typeof dataPagamento !== "string" || !DATA_REGEX.test(dataPagamento))) {
    res.status(400).json({ error: "Data de pagamento inválida." });
    return;
  }

  try {
    res.json(
      await atualizarLancamento(id, {
        descricao: typeof descricao === "string" ? descricao.trim() : undefined,
        categoria: categoria === undefined ? undefined : categoria === null ? null : String(categoria).trim() || null,
        valor,
        vencimento,
        observacao: observacao === undefined ? undefined : observacao === null ? null : String(observacao).trim() || null,
        status,
        dataPagamento,
      })
    );
  } catch (err) {
    erro(res, err, "Falha ao atualizar lançamento.");
  }
});

contasRouter.post("/:id/marcar-pago", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  if (!(await garantirAcessoAoLancamento(req, res, id))) return;

  const { dataPagamento } = req.body ?? {};
  if (dataPagamento !== undefined && (typeof dataPagamento !== "string" || !DATA_REGEX.test(dataPagamento))) {
    res.status(400).json({ error: "Data de pagamento inválida." });
    return;
  }
  try {
    res.json(await marcarComoPago(id, dataPagamento));
  } catch (err) {
    erro(res, err, "Falha ao marcar como pago.");
  }
});

contasRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  if (!(await garantirAcessoAoLancamento(req, res, id))) return;

  try {
    await excluirLancamento(id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao excluir lançamento.");
  }
});

// Cadastro de fornecedores/clientes — mesma permissão "contas" do resto do
// módulo, sem gate extra de admin.
contasRouter.get("/contatos", async (req, res) => {
  const { tipo } = req.query;
  const tipoValido = typeof tipo === "string" && TIPOS_CONTATO_VALIDOS.has(tipo) ? (tipo as TipoContato) : undefined;
  try {
    res.json(await listarContatos(tipoValido));
  } catch (err) {
    erro(res, err, "Falha ao carregar contatos.");
  }
});

contasRouter.post("/contatos", async (req, res) => {
  const { tipo, nome, documento, dadosBancarios, contato } = req.body ?? {};
  if (typeof tipo !== "string" || !TIPOS_CONTATO_VALIDOS.has(tipo)) {
    res.status(400).json({ error: "Informe o tipo (fornecedor ou cliente)." });
    return;
  }
  if (typeof nome !== "string" || !nome.trim()) {
    res.status(400).json({ error: "Informe o nome." });
    return;
  }
  try {
    res.json(
      await criarContato({
        tipo: tipo as TipoContato,
        nome: nome.trim(),
        documento: typeof documento === "string" && documento.trim() ? documento.trim() : null,
        dadosBancarios: typeof dadosBancarios === "string" && dadosBancarios.trim() ? dadosBancarios.trim() : null,
        contato: typeof contato === "string" && contato.trim() ? contato.trim() : null,
      })
    );
  } catch (err) {
    erro(res, err, "Falha ao criar contato.");
  }
});

contasRouter.patch("/contatos/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  const { nome, documento, dadosBancarios, contato } = req.body ?? {};
  if (nome !== undefined && (typeof nome !== "string" || !nome.trim())) {
    res.status(400).json({ error: "Nome inválido." });
    return;
  }
  try {
    res.json(
      await atualizarContato(id, {
        nome: typeof nome === "string" ? nome.trim() : undefined,
        documento: documento === undefined ? undefined : documento === null ? null : String(documento).trim() || null,
        dadosBancarios:
          dadosBancarios === undefined ? undefined : dadosBancarios === null ? null : String(dadosBancarios).trim() || null,
        contato: contato === undefined ? undefined : contato === null ? null : String(contato).trim() || null,
      })
    );
  } catch (err) {
    erro(res, err, "Falha ao atualizar contato.");
  }
});

contasRouter.delete("/contatos/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await excluirContato(id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao excluir contato.");
  }
});
