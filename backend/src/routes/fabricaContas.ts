import { Router, Request, Response } from "express";
import {
  listarContas,
  criarConta,
  atualizarConta,
  definirStatusConta,
  excluirConta,
  resumoContas,
  type ContaEntrada,
  type TipoConta,
  type StatusConta,
} from "../services/fabricaContasService";
import { aplicarContaInsumo } from "../services/fabricaEstoqueService";

export const fabricaContasRouter = Router();

function erro(res: Response, err: unknown, padrao: string) {
  console.error("[fabrica-contas]", err);
  res.status(400).json({ error: err instanceof Error && err.message ? err.message : padrao });
}

const TIPOS: TipoConta[] = ["pagar", "receber"];
const STATUS: StatusConta[] = ["pendente", "pago", "cancelado"];

function lerEntrada(req: Request): ContaEntrada | string {
  const b = req.body ?? {};
  if (typeof b.descricao !== "string" || !b.descricao.trim()) return "Informe a descrição.";
  const valor = Number(b.valor);
  if (!Number.isFinite(valor) || valor <= 0) return "Valor inválido.";
  if (typeof b.vencimento !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.vencimento)) {
    return "Informe o vencimento.";
  }
  const tipo: TipoConta = TIPOS.includes(b.tipo) ? b.tipo : "pagar";
  const status: StatusConta = STATUS.includes(b.status) ? b.status : "pendente";
  const materiaPrimaId = Number.isInteger(Number(b.materiaPrimaId)) && Number(b.materiaPrimaId) > 0
    ? Number(b.materiaPrimaId)
    : null;
  const percentual = b.percentualProducao === undefined ? 100 : Number(b.percentualProducao);
  if (!Number.isFinite(percentual) || percentual <= 0 || percentual > 100) {
    return "Percentual deve ficar entre 1 e 100.";
  }
  const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  return {
    tipo,
    descricao: b.descricao.trim(),
    categoria: texto(b.categoria),
    contraparte: texto(b.contraparte),
    valor,
    vencimento: b.vencimento,
    status,
    dataPagamento: typeof b.dataPagamento === "string" && b.dataPagamento ? b.dataPagamento : null,
    custoFixo: b.custoFixo !== false,
    observacao: texto(b.observacao),
    materiaPrimaId,
    percentualProducao: percentual,
  };
}

fabricaContasRouter.get("/", async (req, res) => {
  const { tipo, status, de, ate } = req.query;
  try {
    res.json({
      contas: await listarContas({
        tipo: TIPOS.includes(tipo as TipoConta) ? (tipo as TipoConta) : undefined,
        status: STATUS.includes(status as StatusConta) ? (status as StatusConta) : undefined,
        de: typeof de === "string" && de ? de : undefined,
        ate: typeof ate === "string" && ate ? ate : undefined,
      }),
    });
  } catch (err) {
    erro(res, err, "Falha ao carregar contas.");
  }
});

fabricaContasRouter.get("/resumo", async (req, res) => {
  const { de, ate } = req.query;
  try {
    res.json({
      resumo: await resumoContas(
        typeof de === "string" && de ? de : undefined,
        typeof ate === "string" && ate ? ate : undefined
      ),
    });
  } catch (err) {
    erro(res, err, "Falha ao calcular o resumo.");
  }
});

fabricaContasRouter.post("/", async (req, res) => {
  const entrada = lerEntrada(req);
  if (typeof entrada === "string") return res.status(400).json({ error: entrada });
  const repetir = Number(req.body?.repetirMeses);
  try {
    const { ids } = await criarConta(entrada, Number.isFinite(repetir) ? repetir : 0);
    // conta ligada a insumo acerta o preço do quilo na hora
    if (entrada.materiaPrimaId) {
      for (const id of ids) await aplicarContaInsumo(id);
    }
    res.status(201).json({ ids });
  } catch (err) {
    erro(res, err, "Falha ao criar a conta.");
  }
});

fabricaContasRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  const entrada = lerEntrada(req);
  if (typeof entrada === "string") return res.status(400).json({ error: entrada });
  try {
    await atualizarConta(id, entrada);
    if (entrada.materiaPrimaId) await aplicarContaInsumo(id);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao salvar a conta.");
  }
});

// Marcar como paga é rota separada: é o clique mais frequente da tela e não
// pode arrastar junto uma edição acidental do resto da conta.
fabricaContasRouter.put("/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  const status = req.body?.status;
  if (!STATUS.includes(status)) return res.status(400).json({ error: "Status inválido." });
  const dataPagamento =
    typeof req.body?.dataPagamento === "string" && req.body.dataPagamento
      ? req.body.dataPagamento
      : null;
  try {
    await definirStatusConta(id, status, dataPagamento);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao mudar o status.");
  }
});

fabricaContasRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  try {
    await excluirConta(id);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao excluir a conta.");
  }
});
