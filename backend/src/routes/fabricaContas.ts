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
import { montarDre, definirAliquota } from "../services/fabricaDreService";

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
    formaPagamento: texto(b.formaPagamento),
    documento: texto(b.documento),
  };
}

fabricaContasRouter.get("/", async (req, res) => {
  const { tipo, status, de, ate, limite } = req.query;
  try {
    // `limite` estava sendo ignorado: quem pedisse 5.000 recebia as 300 mais
    // recentes e nada dizia que o resto ficou de fora. Somar o que voltava dava
    // um total que parecia o total — e nao era. Mesmo buraco dos pagamentos
    // limitados a 100, que escondiam R$ 2,1 milhoes.
    const n = Number(limite);
    const contas = await listarContas({
      tipo: TIPOS.includes(tipo as TipoConta) ? (tipo as TipoConta) : undefined,
      status: STATUS.includes(status as StatusConta) ? (status as StatusConta) : undefined,
      de: typeof de === "string" && de ? de : undefined,
      ate: typeof ate === "string" && ate ? ate : undefined,
      limite: Number.isFinite(n) && n > 0 ? Math.min(n, 20000) : undefined,
    });
    res.json({
      contas,
      // quem le sabe se veio tudo. Lista truncada em silencio e pior que erro.
      truncado: contas.length >= (Number.isFinite(n) && n > 0 ? Math.min(n, 20000) : 300),
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

// DRE vive no mesmo router e na mesma permissao: quem lanca a despesa e quem
// le o resultado. Um modulo separado so pra isso obrigaria mais uma permissao
// pra ver numero que ja vem daqui.
fabricaContasRouter.get("/dre", async (req, res) => {
  const { de, ate } = req.query;
  try {
    res.json({
      dre: await montarDre(
        typeof de === "string" && de ? de : undefined,
        typeof ate === "string" && ate ? ate : undefined
      ),
    });
  } catch (err) {
    erro(res, err, "Falha ao montar o DRE.");
  }
});

// Reprocessar o mes e so mudar a aliquota: o DRE e calculado na leitura, entao
// corrigir a % de marco refaz marco na hora, sem refazer lancamento nenhum.
fabricaContasRouter.put("/dre/imposto", async (req, res) => {
  const competencia = req.body?.competencia;
  if (typeof competencia !== "string" || !/^\d{4}-\d{2}/.test(competencia)) {
    return res.status(400).json({ error: "Informe o mes." });
  }
  const percentual = Number(req.body?.percentual);
  if (!Number.isFinite(percentual) || percentual < 0 || percentual > 100) {
    return res.status(400).json({ error: "Percentual deve ficar entre 0 e 100." });
  }
  try {
    await definirAliquota(competencia, percentual);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao salvar a aliquota.");
  }
});

fabricaContasRouter.post("/", async (req, res) => {
  const entrada = lerEntrada(req);
  if (typeof entrada === "string") return res.status(400).json({ error: entrada });
  const repetir = Number(req.body?.repetirMeses);
  try {
    const { ids } = await criarConta(entrada, Number.isFinite(repetir) ? repetir : 0);
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
