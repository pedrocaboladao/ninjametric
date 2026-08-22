import { Router, Request, Response } from "express";
import {
  listarPedidos,
  obterPedido,
  criarPedido,
  atualizarPedido,
  definirStatus,
  excluirPedido,
  statusValido,
  type PedidoEntrada,
  type ItemEntrada,
  type StatusPedido,
} from "../services/fabricaPedidosService";
import {
  listarContaCorrente,
  extratoDoCliente,
  listarPagamentos,
  registrarPagamento,
  excluirPagamento,
} from "../services/fabricaPagamentosService";
import {
  listarDevolucoes,
  registrarDevolucao,
  marcarNotaCancelada,
  excluirDevolucao,
  notasPendentes,
  CONDICOES,
  registrarRessarcimento,
  definirCredito,
  consolidadoRessarcimento,
  STATUS_RESSARCIMENTO,
  type CondicaoDevolucao,
  type StatusRessarcimento,
} from "../services/fabricaDevolucoesService";

export const fabricaPedidosRouter = Router();

function erro(res: Response, err: unknown, padrao: string) {
  console.error("[fabrica-pedidos]", err);
  res.status(400).json({ error: err instanceof Error && err.message ? err.message : padrao });
}

function lerEntrada(req: Request): PedidoEntrada | string {
  const b = req.body ?? {};
  const clienteId = Number(b.clienteId);
  if (!Number.isInteger(clienteId) || clienteId <= 0) return "Escolha o cliente.";
  if (!Array.isArray(b.itens) || !b.itens.length) return "O pedido precisa de pelo menos um item.";

  const itens: ItemEntrada[] = [];
  for (const bruto of b.itens) {
    const produtoId = Number(bruto?.produtoId);
    if (!Number.isInteger(produtoId) || produtoId <= 0) return "Item sem produto.";
    const quantidade = Number(bruto?.quantidade);
    if (!Number.isFinite(quantidade) || quantidade <= 0) return "Quantidade deve ser maior que zero.";
    // preço vazio significa "usa o do cadastro", não "de graça"
    const bruto_preco = bruto?.precoUnitario;
    const precoUnitario =
      bruto_preco === null || bruto_preco === undefined || bruto_preco === ""
        ? null
        : Number(bruto_preco);
    if (precoUnitario !== null && (!Number.isFinite(precoUnitario) || precoUnitario < 0)) {
      return "Preço unitário inválido.";
    }
    itens.push({ produtoId, quantidade, precoUnitario });
  }

  const status: StatusPedido = statusValido(b.status) ? b.status : "ABERTO";
  return {
    clienteId,
    data: typeof b.data === "string" && b.data ? b.data : null,
    status,
    observacao: typeof b.observacao === "string" && b.observacao.trim() ? b.observacao.trim() : null,
    itens,
  };
}

fabricaPedidosRouter.get("/", async (req, res) => {
  const clienteId = Number(req.query.clienteId);
  const status = req.query.status;
  try {
    res.json({
      pedidos: await listarPedidos({
        clienteId: Number.isInteger(clienteId) && clienteId > 0 ? clienteId : undefined,
        status: statusValido(status) ? status : undefined,
        de: typeof req.query.de === "string" && req.query.de ? req.query.de : undefined,
        ate: typeof req.query.ate === "string" && req.query.ate ? req.query.ate : undefined,
      }),
    });
  } catch (err) {
    erro(res, err, "Falha ao carregar pedidos.");
  }
});

// Conta corrente e pagamentos vivem aqui porque sao a mesma tela e a mesma
// pessoa: quem lanca o pedido e quem fecha na terca e recebe o PIX.
fabricaPedidosRouter.get("/conta-corrente", async (_req, res) => {
  try {
    res.json({ contas: await listarContaCorrente() });
  } catch (err) {
    erro(res, err, "Falha ao carregar a conta corrente.");
  }
});

fabricaPedidosRouter.get("/conta-corrente/:clienteId", async (req, res) => {
  const clienteId = Number(req.params.clienteId);
  if (!Number.isInteger(clienteId)) return res.status(400).json({ error: "Id invalido." });
  try {
    res.json({ extrato: await extratoDoCliente(clienteId) });
  } catch (err) {
    erro(res, err, "Falha ao carregar o extrato.");
  }
});

fabricaPedidosRouter.get("/pagamentos", async (_req, res) => {
  try {
    res.json({ pagamentos: await listarPagamentos() });
  } catch (err) {
    erro(res, err, "Falha ao carregar pagamentos.");
  }
});

fabricaPedidosRouter.post("/pagamentos", async (req, res) => {
  const b = req.body ?? {};
  const clienteId = Number(b.clienteId);
  if (!Number.isInteger(clienteId)) return res.status(400).json({ error: "Escolha a loja." });
  const valor = Number(b.valor);
  if (!Number.isFinite(valor) || valor <= 0) {
    return res.status(400).json({ error: "Valor invalido." });
  }
  const data = typeof b.data === "string" && b.data ? b.data : null;
  const observacao =
    typeof b.observacao === "string" && b.observacao.trim() ? b.observacao.trim() : null;
  try {
    res.status(201).json(await registrarPagamento(clienteId, valor, data, observacao));
  } catch (err) {
    erro(res, err, "Falha ao registrar o pagamento.");
  }
});

fabricaPedidosRouter.delete("/pagamentos/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id invalido." });
  try {
    await excluirPagamento(id);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao excluir o pagamento.");
  }
});

// Devolucao vive aqui: e o caminho de volta da mesma venda, e quem recebe o
// produto no balcao e quem lanca o pedido.
fabricaPedidosRouter.get("/devolucoes", async (req, res) => {
  const clienteId = Number(req.query.clienteId);
  const condicao = req.query.condicao;
  try {
    const [devolucoes, pendentes] = await Promise.all([
      listarDevolucoes({
        clienteId: Number.isInteger(clienteId) && clienteId > 0 ? clienteId : undefined,
        condicao: CONDICOES.includes(condicao as CondicaoDevolucao)
          ? (condicao as CondicaoDevolucao)
          : undefined,
      }),
      notasPendentes(),
    ]);
    res.json({
      devolucoes,
      notasPendentes: pendentes,
      consolidado: await consolidadoRessarcimento(),
    });
  } catch (err) {
    erro(res, err, "Falha ao carregar devolucoes.");
  }
});

fabricaPedidosRouter.post("/devolucoes", async (req, res) => {
  const b = req.body ?? {};
  const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const condicao: CondicaoDevolucao = CONDICOES.includes(b.condicao) ? b.condicao : "BOM";
  const credito =
    b.credito === undefined || b.credito === null || b.credito === "" ? null : Number(b.credito);
  if (credito !== null && (!Number.isFinite(credito) || credito < 0)) {
    return res.status(400).json({ error: "Credito invalido." });
  }
  try {
    res.status(201).json(
      await registrarDevolucao({
        clienteId: Number(b.clienteId),
        produtoId: Number(b.produtoId),
        data: typeof b.data === "string" && b.data ? b.data : null,
        quantidade: Number(b.quantidade),
        condicao,
        credito,
        notaFiscal: texto(b.notaFiscal),
        recebidoPor: texto(b.recebidoPor),
        observacao: texto(b.observacao),
      })
    );
  } catch (err) {
    erro(res, err, "Falha ao registrar a devolucao.");
  }
});

fabricaPedidosRouter.put("/devolucoes/:id/nota", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id invalido." });
  try {
    await marcarNotaCancelada(id, req.body?.notaCancelada !== false);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao marcar a nota.");
  }
});

fabricaPedidosRouter.put("/devolucoes/:id/ressarcimento", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id invalido." });
  const b = req.body ?? {};
  if (!STATUS_RESSARCIMENTO.includes(b.status)) {
    return res.status(400).json({ error: "Status invalido." });
  }
  const valor = Number(b.valor);
  if (!Number.isFinite(valor) || valor < 0) {
    return res.status(400).json({ error: "Valor invalido." });
  }
  const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  try {
    await registrarRessarcimento(
      id,
      b.status as StatusRessarcimento,
      valor,
      typeof b.data === "string" && b.data ? b.data : null,
      texto(b.protocolo)
    );
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao registrar o ressarcimento.");
  }
});

fabricaPedidosRouter.put("/devolucoes/:id/credito", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id invalido." });
  const credito = Number(req.body?.credito);
  if (!Number.isFinite(credito) || credito < 0) {
    return res.status(400).json({ error: "Credito invalido." });
  }
  try {
    await definirCredito(id, credito);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao salvar o credito.");
  }
});

fabricaPedidosRouter.delete("/devolucoes/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id invalido." });
  try {
    await excluirDevolucao(id);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao excluir a devolucao.");
  }
});

fabricaPedidosRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  try {
    const pedido = await obterPedido(id);
    if (!pedido) return res.status(404).json({ error: "Pedido não encontrado." });
    res.json({ pedido });
  } catch (err) {
    erro(res, err, "Falha ao carregar pedido.");
  }
});

fabricaPedidosRouter.post("/", async (req, res) => {
  const entrada = lerEntrada(req);
  if (typeof entrada === "string") return res.status(400).json({ error: entrada });
  try {
    res.status(201).json(await criarPedido(entrada));
  } catch (err) {
    erro(res, err, "Falha ao criar pedido.");
  }
});

fabricaPedidosRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  const entrada = lerEntrada(req);
  if (typeof entrada === "string") return res.status(400).json({ error: entrada });
  try {
    await atualizarPedido(id, entrada);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao salvar pedido.");
  }
});

// Trocar o status é uma rota separada de propósito: marcar como entregue não
// pode reprecificar o pedido nem mexer nos itens.
fabricaPedidosRouter.put("/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  const status = req.body?.status;
  if (!statusValido(status)) return res.status(400).json({ error: "Status inválido." });
  try {
    await definirStatus(id, status);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao mudar o status.");
  }
});

fabricaPedidosRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  try {
    await excluirPedido(id);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao excluir pedido.");
  }
});

// Conferência das vendas do Mercado Livre antes de virarem pedido.
//
// Só lê e agrupa: nada é lançado aqui. As lojas trabalham com estoque zero, e a
// expedição fica no mesmo galpão — então a venda no ML é a retirada do estoque
// da fábrica, e o que a API sabe é o que o Hudson hoje digita à mão.
fabricaPedidosRouter.get("/vendas-ml", async (req, res) => {
  const de = typeof req.query.de === "string" ? req.query.de : "";
  const ate = typeof req.query.ate === "string" ? req.query.ate : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
    return res.status(400).json({ error: "Informe o período (de e até)." });
  }
  try {
    res.json(await conferirVendasMl(de, ate));
  } catch (err) {
    erro(res, err, "Falha ao buscar as vendas do Mercado Livre.");
  }
});
