import { Router, Request, Response } from "express";
import {
  listarCreditos,
  saldosPorCliente,
  saldoDoCliente,
  criarCredito,
  excluirCredito,
  lancarAntecipacao,
  percentualBonificacao,
  definirPercentualBonificacao,
  type OrigemCredito,
} from "../services/fabricaCreditosService";

export const fabricaCreditosRouter = Router();

function erro(res: Response, err: unknown, padrao: string) {
  console.error("[fabrica-creditos]", err);
  res.status(400).json({ error: err instanceof Error && err.message ? err.message : padrao });
}

function texto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

const ORIGENS: OrigemCredito[] = ["ANTECIPACAO", "BONIFICACAO", "AJUSTE", "USO"];

// AAAA-MM-DD, ou hoje. Data inventada pelo navegador não entra: o crédito
// aparece no extrato por data, e uma data errada some do fechamento certo.
function data(v: unknown): string {
  const t = typeof v === "string" ? v.trim() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return new Date().toISOString().slice(0, 10);
}

fabricaCreditosRouter.get("/", async (req, res) => {
  const clienteId = Number(req.query.clienteId);
  try {
    const [creditos, saldos, percentual] = await Promise.all([
      listarCreditos(Number.isInteger(clienteId) && clienteId > 0 ? clienteId : undefined),
      saldosPorCliente(),
      percentualBonificacao(),
    ]);
    res.json({ creditos, saldos, percentual });
  } catch (err) {
    erro(res, err, "Falha ao carregar créditos.");
  }
});

fabricaCreditosRouter.get("/saldo/:clienteId", async (req, res) => {
  const id = Number(req.params.clienteId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  try {
    res.json({ saldo: await saldoDoCliente(id) });
  } catch (err) {
    erro(res, err, "Falha ao buscar saldo.");
  }
});

// Antecipação: um POST só grava o dinheiro adiantado e a bonificação sobre
// ele. Deixar a tela mandar dois lançamentos separados abriria a porta pra
// alguém lançar a antecipação e esquecer os 3,5%.
fabricaCreditosRouter.post("/antecipacao", async (req: Request, res: Response) => {
  const b = req.body ?? {};
  const clienteId = Number(b.clienteId);
  const valor = Number(b.valor);
  if (!Number.isInteger(clienteId) || clienteId <= 0)
    return res.status(400).json({ error: "Escolha a loja." });
  if (!Number.isFinite(valor) || valor <= 0)
    return res.status(400).json({ error: "Informe o valor antecipado." });
  try {
    res.status(201).json(await lancarAntecipacao(clienteId, data(b.data), valor, texto(b.observacao)));
  } catch (err) {
    erro(res, err, "Falha ao lançar a antecipação.");
  }
});

fabricaCreditosRouter.post("/", async (req: Request, res: Response) => {
  const b = req.body ?? {};
  const clienteId = Number(b.clienteId);
  const valor = Number(b.valor);
  const origem = ORIGENS.includes(b.origem) ? (b.origem as OrigemCredito) : "AJUSTE";
  if (!Number.isInteger(clienteId) || clienteId <= 0)
    return res.status(400).json({ error: "Escolha a loja." });
  if (!Number.isFinite(valor) || valor === 0)
    return res.status(400).json({ error: "Informe o valor." });
  try {
    res.status(201).json(
      await criarCredito({
        clienteId,
        data: data(b.data),
        origem,
        valor,
        pagamentoId: Number.isInteger(Number(b.pagamentoId)) && Number(b.pagamentoId) > 0
          ? Number(b.pagamentoId)
          : null,
        observacao: texto(b.observacao),
      })
    );
  } catch (err) {
    erro(res, err, "Falha ao lançar o crédito.");
  }
});

fabricaCreditosRouter.put("/percentual", async (req, res) => {
  const p = Number((req.body ?? {}).percentual);
  if (!Number.isFinite(p) || p < 0 || p > 100)
    return res.status(400).json({ error: "Percentual deve ficar entre 0 e 100." });
  try {
    await definirPercentualBonificacao(p);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao salvar o percentual.");
  }
});

fabricaCreditosRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  try {
    await excluirCredito(id);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao excluir o crédito.");
  }
});
