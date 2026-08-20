import { Router, Request, Response } from "express";
import {
  listarEmbalagens,
  criarEmbalagem,
  atualizarEmbalagem,
  excluirEmbalagem,
  listarEmbalagensDeFormulas,
  ligarEmbalagem,
  ligarAutomaticamentePorPeso,
  type EmbalagemEntrada,
} from "../services/fabricaEmbalagensService";
import {
  listarEstoqueEmbalagens,
  listarComprasEmbalagem,
  registrarCompraEmbalagem,
  excluirCompraEmbalagem,
  listarAjustesEmbalagem,
  registrarAjusteEmbalagem,
  registrarInventarioEmbalagem,
  excluirAjusteEmbalagem,
} from "../services/fabricaEmbalagemEstoqueService";

export const fabricaEmbalagensRouter = Router();

function erro(res: Response, err: unknown, padrao: string) {
  console.error("[fabrica-embalagens]", err);
  res.status(400).json({ error: err instanceof Error && err.message ? err.message : padrao });
}

function numero(v: unknown, minimo = 0): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= minimo ? n : null;
}

function lerEntrada(req: Request): EmbalagemEntrada | string {
  const b = req.body ?? {};
  if (typeof b.nome !== "string" || !b.nome.trim()) return "Informe o nome da embalagem.";
  const pesoKg = numero(b.pesoKg);
  if (pesoKg === null || pesoKg <= 0) return "Peso deve ser maior que zero.";
  const custoUnitario = numero(b.custoUnitario);
  if (custoUnitario === null) return "Custo unitário inválido.";
  const estoqueMinimo = numero(b.estoqueMinimo);
  if (estoqueMinimo === null) return "Estoque mínimo inválido.";
  // saldo não entra aqui: é calculado de compras, consumo e ajustes
  const equivaleAId = Number.isInteger(Number(b.equivaleAId)) && Number(b.equivaleAId) > 0
    ? Number(b.equivaleAId)
    : null;
  return {
    nome: b.nome.trim(),
    pesoKg,
    custoUnitario,
    estoqueMinimo,
    ativo: b.ativo !== false,
    equivaleAId,
  };
}

fabricaEmbalagensRouter.get("/", async (_req, res) => {
  try {
    res.json({ embalagens: await listarEmbalagens() });
  } catch (err) {
    erro(res, err, "Falha ao carregar embalagens.");
  }
});

fabricaEmbalagensRouter.post("/", async (req, res) => {
  const entrada = lerEntrada(req);
  if (typeof entrada === "string") return res.status(400).json({ error: entrada });
  try {
    res.status(201).json(await criarEmbalagem(entrada));
  } catch (err) {
    erro(res, err, "Falha ao criar embalagem.");
  }
});

fabricaEmbalagensRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  const entrada = lerEntrada(req);
  if (typeof entrada === "string") return res.status(400).json({ error: entrada });
  try {
    await atualizarEmbalagem(id, entrada);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao atualizar embalagem.");
  }
});

fabricaEmbalagensRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  try {
    await excluirEmbalagem(id);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao excluir embalagem.");
  }
});

// --- ligação com as embalagens das fórmulas ---

fabricaEmbalagensRouter.get("/formulas/vinculos", async (_req, res) => {
  try {
    res.json({ vinculos: await listarEmbalagensDeFormulas() });
  } catch (err) {
    erro(res, err, "Falha ao carregar vínculos.");
  }
});

fabricaEmbalagensRouter.put("/formulas/vinculos/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  const alvo = req.body?.fabricaEmbalagemId;
  const fabricaEmbalagemId = alvo === null || alvo === undefined || alvo === "" ? null : Number(alvo);
  if (fabricaEmbalagemId !== null && !Number.isInteger(fabricaEmbalagemId)) {
    return res.status(400).json({ error: "Embalagem inválida." });
  }
  try {
    await ligarEmbalagem(id, fabricaEmbalagemId);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao ligar embalagem.");
  }
});

fabricaEmbalagensRouter.post("/formulas/vincular-por-peso", async (_req, res) => {
  try {
    res.json(await ligarAutomaticamentePorPeso());
  } catch (err) {
    erro(res, err, "Falha ao vincular por peso.");
  }
});

// --- estoque, compras e ajustes ---------------------------------------------
//
// Ficam no mesmo router porque são a mesma tela e a mesma permissão: quem
// cadastra o balde é quem compra e quem conta.

fabricaEmbalagensRouter.get("/estoque", async (_req, res) => {
  try {
    res.json({ estoque: await listarEstoqueEmbalagens() });
  } catch (err) {
    erro(res, err, "Falha ao carregar estoque de embalagens.");
  }
});

fabricaEmbalagensRouter.get("/compras", async (_req, res) => {
  try {
    res.json({ compras: await listarComprasEmbalagem() });
  } catch (err) {
    erro(res, err, "Falha ao carregar compras.");
  }
});

fabricaEmbalagensRouter.post("/compras", async (req, res) => {
  const b = req.body ?? {};
  const embalagemId = Number(b.embalagemId);
  if (!Number.isInteger(embalagemId)) return res.status(400).json({ error: "Escolha a embalagem." });
  const quantidade = Number(b.quantidade);
  if (!Number.isInteger(quantidade) || quantidade <= 0) {
    return res.status(400).json({ error: "Quantidade deve ser um número inteiro maior que zero." });
  }
  const custoUnitario = numero(b.custoUnitario);
  if (custoUnitario === null) return res.status(400).json({ error: "Custo unitário inválido." });
  const data = typeof b.data === "string" && b.data ? b.data : null;
  const observacao = typeof b.observacao === "string" && b.observacao.trim() ? b.observacao.trim() : null;
  try {
    res.status(201).json(
      await registrarCompraEmbalagem(embalagemId, quantidade, custoUnitario, data, observacao)
    );
  } catch (err) {
    erro(res, err, "Falha ao registrar compra.");
  }
});

fabricaEmbalagensRouter.delete("/compras/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  try {
    await excluirCompraEmbalagem(id);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao excluir compra.");
  }
});

fabricaEmbalagensRouter.get("/ajustes", async (_req, res) => {
  try {
    res.json({ ajustes: await listarAjustesEmbalagem() });
  } catch (err) {
    erro(res, err, "Falha ao carregar ajustes.");
  }
});

fabricaEmbalagensRouter.post("/ajustes", async (req, res) => {
  const b = req.body ?? {};
  const embalagemId = Number(b.embalagemId);
  if (!Number.isInteger(embalagemId)) return res.status(400).json({ error: "Escolha a embalagem." });
  const motivo = typeof b.motivo === "string" && b.motivo.trim() ? b.motivo.trim() : null;
  try {
    // inventário: o operador diz quanto TEM; ajuste: quanto entra ou sai
    if (b.tipo === "inventario") {
      const contado = Number(b.contado);
      if (!Number.isFinite(contado) || contado < 0) {
        return res.status(400).json({ error: "Quantidade contada inválida." });
      }
      return res.status(201).json(await registrarInventarioEmbalagem(embalagemId, contado, motivo));
    }
    const quantidade = Number(b.quantidade);
    if (!Number.isInteger(quantidade) || quantidade === 0) {
      return res.status(400).json({ error: "Informe a quantidade (positiva entra, negativa sai)." });
    }
    res.status(201).json(await registrarAjusteEmbalagem(embalagemId, quantidade, motivo));
  } catch (err) {
    erro(res, err, "Falha ao registrar ajuste.");
  }
});

fabricaEmbalagensRouter.delete("/ajustes/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  try {
    await excluirAjusteEmbalagem(id);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao excluir ajuste.");
  }
});
