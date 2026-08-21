import { Router, Response } from "express";
import {
  listarEstoque,
  definirEstoqueMinimo,
  definirControlaEstoque,
  listarAjustes,
  registrarAjuste,
  registrarInventario,
  excluirAjuste,
  capacidadeDeProducao,
  listarContasInsumo,
  aplicarContaInsumo,
} from "../services/fabricaEstoqueService";
import { criarConta, excluirConta } from "../services/fabricaContasService";

export const fabricaEstoqueRouter = Router();

function erro(res: Response, err: unknown, padrao: string) {
  console.error("[fabrica-estoque]", err);
  res.status(400).json({ error: err instanceof Error && err.message ? err.message : padrao });
}

fabricaEstoqueRouter.get("/", async (_req, res) => {
  try {
    res.json({ estoque: await listarEstoque() });
  } catch (err) {
    erro(res, err, "Falha ao carregar estoque.");
  }
});

fabricaEstoqueRouter.get("/capacidade", async (_req, res) => {
  try {
    res.json({ capacidade: await capacidadeDeProducao() });
  } catch (err) {
    erro(res, err, "Falha ao calcular capacidade de produção.");
  }
});

fabricaEstoqueRouter.put("/:id/minimo", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  const minimo = Number(req.body?.estoqueMinimo);
  if (!Number.isFinite(minimo) || minimo < 0) {
    return res.status(400).json({ error: "Estoque mínimo inválido." });
  }
  try {
    await definirEstoqueMinimo(id, minimo);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao definir estoque mínimo.");
  }
});

fabricaEstoqueRouter.get("/contas", async (_req, res) => {
  try {
    res.json({ contas: await listarContasInsumo() });
  } catch (err) {
    erro(res, err, "Falha ao carregar contas.");
  }
});

// Lancar a conta de agua aqui cria uma linha no Contas a pagar da fabrica e ja
// acerta o preco do quilo. Um lancamento so: o dinheiro aparece no financeiro,
// o custo aparece na formula.
fabricaEstoqueRouter.post("/contas", async (req, res) => {
  const b = req.body ?? {};
  const materiaPrimaId = Number(b.materiaPrimaId);
  if (!Number.isInteger(materiaPrimaId)) {
    return res.status(400).json({ error: "Escolha o insumo." });
  }
  if (typeof b.competencia !== "string" || !/^\d{4}-\d{2}/.test(b.competencia)) {
    return res.status(400).json({ error: "Informe o mes da conta." });
  }
  const valor = Number(b.valor);
  if (!Number.isFinite(valor) || valor <= 0) {
    return res.status(400).json({ error: "Valor da conta invalido." });
  }
  const percentual = b.percentualProducao === undefined ? 100 : Number(b.percentualProducao);
  if (!Number.isFinite(percentual) || percentual <= 0 || percentual > 100) {
    return res.status(400).json({ error: "Percentual deve ficar entre 1 e 100." });
  }
  const descricao =
    typeof b.descricao === "string" && b.descricao.trim() ? b.descricao.trim() : "Conta de consumo";
  const observacao =
    typeof b.observacao === "string" && b.observacao.trim() ? b.observacao.trim() : null;

  try {
    // vencimento no dia 1 do mes de consumo: o mes e o que importa pro rateio,
    // e o dia exato do boleto pode ser ajustado depois no financeiro
    const { ids } = await criarConta({
      tipo: "pagar",
      descricao,
      categoria: "CONSUMO",
      contraparte: null,
      valor,
      vencimento: `${b.competencia.slice(0, 7)}-01`,
      status: "pendente",
      dataPagamento: null,
      // agua e insumo de producao, nao custo fixo: varia com o quanto se produz
      custoFixo: false,
      observacao,
      materiaPrimaId,
      percentualProducao: percentual,
    });
    const r = await aplicarContaInsumo(ids[0]);
    res.status(201).json({ id: ids[0], ...r });
  } catch (err) {
    erro(res, err, "Falha ao lancar a conta.");
  }
});

fabricaEstoqueRouter.delete("/contas/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id invalido." });
  try {
    await excluirConta(id);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao excluir a conta.");
  }
});

fabricaEstoqueRouter.put("/:id/controla", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  if (typeof req.body?.controlaEstoque !== "boolean") {
    return res.status(400).json({ error: "Informe controlaEstoque como verdadeiro ou falso." });
  }
  try {
    await definirControlaEstoque(id, req.body.controlaEstoque);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao mudar o controle de estoque.");
  }
});

fabricaEstoqueRouter.get("/ajustes", async (_req, res) => {
  try {
    res.json({ ajustes: await listarAjustes() });
  } catch (err) {
    erro(res, err, "Falha ao carregar ajustes.");
  }
});

fabricaEstoqueRouter.post("/ajustes", async (req, res) => {
  const materiaPrimaId = Number(req.body?.materiaPrimaId);
  if (!Number.isInteger(materiaPrimaId)) {
    return res.status(400).json({ error: "Escolha a matéria-prima." });
  }
  const motivo = typeof req.body?.motivo === "string" && req.body.motivo.trim() ? req.body.motivo.trim() : null;
  try {
    // inventário: o operador diz quanto TEM; ajuste: quanto entra ou sai
    if (req.body?.tipo === "inventario") {
      const contado = Number(req.body?.contadoKg);
      if (!Number.isFinite(contado) || contado < 0) {
        return res.status(400).json({ error: "Quantidade contada inválida." });
      }
      return res.status(201).json(await registrarInventario(materiaPrimaId, contado, motivo));
    }
    const quantidade = Number(req.body?.quantidadeKg);
    if (!Number.isFinite(quantidade) || quantidade === 0) {
      return res.status(400).json({ error: "Informe a quantidade (positiva entra, negativa sai)." });
    }
    res.status(201).json(await registrarAjuste(materiaPrimaId, quantidade, motivo));
  } catch (err) {
    erro(res, err, "Falha ao registrar ajuste.");
  }
});

fabricaEstoqueRouter.delete("/ajustes/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  try {
    await excluirAjuste(id);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao excluir ajuste.");
  }
});
