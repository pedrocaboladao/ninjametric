import multer from "multer";
import { planilhaParaTexto } from "../services/fabricaPlanilhaArquivoService";
import { Router, Request, Response } from "express";
import { conferirVendasMl } from "../services/fabricaVendasMlService";
import { idadeDoSaldo } from "../services/fabricaIdadeService";
import {
  conferirContasReceber,
  criarContaReceber,
} from "../services/blingContasService";
import { contatoIdPorDocumento } from "../services/blingContatosService";
import { listarClientes } from "../services/fabricaClientesService";
import { conferirPlanilhaVendas } from "../services/fabricaVendasPlanilhaService";
import {
  listarApelidos,
  criarApelido,
  excluirApelido,
} from "../services/fabricaClienteApelidosService";
import {
  listarApelidosSku,
  criarApelidoSku,
  excluirApelidoSku,
} from "../services/fabricaProdutoApelidosService";
import {
  importarPlanilhaVendas,
  skusFaltando,
  clientesFaltando,
} from "../services/fabricaImportarVendasService";
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
  contarPedidos,
  preencherCustoFaltante,
  refazerPeriodo,
} from "../services/fabricaPedidosService";
import {
  listarContaCorrente,
  extratoDoCliente,
  contarPagamentos,
  excluirFechamento,
  gravarFechamento,
  listarFechamentos,
  listarPagamentos,
  montarFechamento,
  proximoPeriodo,
  registrarPagamento,
  excluirPagamento,
  marcarAntecipacao,
  alocarPorAntiguidade,
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
  const limite = Number(req.query.limite);
  const filtro = {
    clienteId: Number.isInteger(clienteId) && clienteId > 0 ? clienteId : undefined,
    status: statusValido(status) ? status : undefined,
    de: typeof req.query.de === "string" && req.query.de ? req.query.de : undefined,
    ate: typeof req.query.ate === "string" && req.query.ate ? req.query.ate : undefined,
    limite: Number.isInteger(limite) && limite > 0 ? limite : undefined,
  };
  try {
    // o total vem junto pra tela poder dizer "mostrando 200 de 334" em vez de
    // deixar quem conta na tela achar que sumiu pedido
    const [pedidos, total] = await Promise.all([listarPedidos(filtro), contarPedidos(filtro)]);
    res.json({ pedidos, total });
  } catch (err) {
    erro(res, err, "Falha ao carregar pedidos.");
  }
});

// Conta corrente e pagamentos vivem aqui porque sao a mesma tela e a mesma
// pessoa: quem lanca o pedido e quem fecha na terca e recebe o PIX.
// Idade do saldo: ha quanto tempo cada loja esta devendo. Fica antes de
// "/conta-corrente/:clienteId" nao por acaso — uma rota com parametro casaria
// com "idade-do-saldo" e devolveria "id invalido".
fabricaPedidosRouter.get("/idade-do-saldo", async (_req, res) => {
  try {
    res.json(await idadeDoSaldo());
  } catch (err) {
    erro(res, err, "Falha ao calcular a idade do saldo.");
  }
});

// Abate do mais velho pro mais novo. Calculado, nunca gravado — o total sai da
// conta corrente e por isso nao tem como divergir dela.
fabricaPedidosRouter.get("/alocacao/:paganteId", async (req, res) => {
  const id = Number(req.params.paganteId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id invalido." });
  try {
    res.json(await alocarPorAntiguidade(id));
  } catch (err) {
    erro(res, err, "Falha ao montar o abatimento.");
  }
});

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

// O fechamento do ciclo: proposto, gravado e listado.
//
// Vem antes do "/:id" — mesma armadilha de sempre.
fabricaPedidosRouter.get("/fechamentos", async (_req, res) => {
  try {
    const [historico, periodo] = await Promise.all([listarFechamentos(), proximoPeriodo()]);
    res.json({ fechamentos: historico, proximo: periodo });
  } catch (err) {
    erro(res, err, "Falha ao carregar os fechamentos.");
  }
});

// Sem gravar: mostra como o ciclo ficaria, pra conferir antes de congelar.
fabricaPedidosRouter.get("/fechamentos/previa", async (req, res) => {
  const de = String(req.query.de ?? "");
  const ate = String(req.query.ate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
    return res.status(400).json({ error: "Informe o período como AAAA-MM-DD." });
  }
  try {
    res.json(await montarFechamento(de, ate));
  } catch (err) {
    erro(res, err, "Falha ao montar o fechamento.");
  }
});

// Resolve o contato do Bling de cada loja pelo CNPJ, uma vez so.
//
// E a chave que liga os dois lados: a conferencia procura o titulo por contato
// e a criacao cria por contato. Resolver aqui, junto, garante que os dois usem
// exatamente o mesmo id — foi a divergencia entre eles que gerou titulo
// duplicado em 04/09/2026.
async function comContato(
  linhas: Array<{ clienteId: number; clienteNome: string; previsto: number }>
): Promise<Array<{ clienteId: number; clienteNome: string; previsto: number; contatoId: number | null }>> {
  const clientes = await listarClientes();
  const docPorId = new Map(clientes.map((c) => [c.id, c.cnpj ?? ""]));
  const saida = [];
  for (const l of linhas) {
    let contatoId: number | null = null;
    try {
      contatoId = await contatoIdPorDocumento(docPorId.get(l.clienteId) ?? "");
    } catch {
      contatoId = null;
    }
    saida.push({ ...l, contatoId });
  }
  return saida;
}

// Confere o fechamento contra os titulos a receber do Bling.
//
// Mora aqui, e nao no router do Bling, pelo mesmo motivo da conferencia de
// contas a pagar: quem le e a tela de cobranca, e um usuario sem
// `fabrica_pedidos` nao tem o que fazer com esta resposta.
fabricaPedidosRouter.get("/fechamentos/conferir-bling", async (req, res) => {
  const de = String(req.query.de ?? "");
  const ate = String(req.query.ate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
    return res.status(400).json({ error: "Informe o período como AAAA-MM-DD." });
  }
  try {
    const f = await montarFechamento(de, ate);
    res.json(await conferirContasReceber(de, ate, await comContato(f.linhas), f.id));
  } catch (err) {
    erro(res, err, "Falha ao conferir contra o Bling.");
  }
});

// Lanca no Bling o titulo das lojas que ainda nao tem.
//
// So cria o que falta: rodar duas vezes nao duplica, porque a conferencia
// roda antes e diz quem ja tem titulo. E uma loja sem contato no ERP nao
// derruba as outras — ela volta na lista de falhas com o motivo.
fabricaPedidosRouter.post("/fechamentos/espelhar-bling", async (req, res) => {
  const b = req.body ?? {};
  const de = String(b.de ?? "");
  const ate = String(b.ate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
    return res.status(400).json({ error: "Informe o período como AAAA-MM-DD." });
  }
  try {
    const f = await montarFechamento(de, ate);
    const linhas = await comContato(f.linhas);
    const conf = await conferirContasReceber(de, ate, linhas, f.id);
    const contatoPorCliente = new Map(linhas.map((l) => [l.clienteId, l.contatoId]));

    const feitos: Array<{ loja: string; ok: boolean; id?: number; erro?: string }> = [];
    // O Bling tem um limite proprio pra conta a receber, alem do teto de 3
    // chamadas por segundo: criar varias em sequencia devolve 400 com
    // `time_limit` no namespace CONTAS_RECEBER e a mensagem "aguarde alguns
    // instantes". Em 04/09/2026 isso deixou passar 4 de 21.
    //
    // Cinco segundos entre uma e outra resolve. Vinte lojas levam cerca de dois
    // minutos, o que e aceitavel numa rotina que roda uma vez por mes — e muito
    // melhor do que metade dos titulos faltando sem ninguem perceber.
    const respirar = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // O limite do Bling nao e so espacamento: mesmo com 5 segundos entre uma e
    // outra ele recusa em lote, com `time_limit` no namespace CONTAS_RECEBER.
    // Em 04/09/2026 foram quatro execucoes manuais pra criar 19 titulos.
    //
    // Como o fechamento mensal roda por tarefa agendada, sem ninguem lendo a
    // resposta, a insistencia tem que estar aqui: espera crescente ate o Bling
    // deixar. Quatro tentativas cobrem folgado o que se viu na pratica.
    const limitou = (e: unknown) => {
      const t = e instanceof Error ? e.message : String(e);
      return t.includes("time_limit") || t.includes("Aguarde alguns instantes");
    };
    const criarInsistindo = async (dados: Parameters<typeof criarContaReceber>[0]) => {
      const esperas = [0, 15000, 30000, 60000];
      let ultimo: unknown;
      for (const espera of esperas) {
        if (espera) await respirar(espera);
        try {
          return await criarContaReceber(dados);
        } catch (err) {
          ultimo = err;
          if (!limitou(err)) throw err;
        }
      }
      throw ultimo;
    };

    let primeira = true;
    for (const l of conf.linhas) {
      if (l.tituloBling !== null || l.clienteId === null) continue;
      if (l.previstoSite <= 0) continue;
      try {
        if (!primeira) await respirar(5000);
        primeira = false;
        const contatoId = contatoPorCliente.get(l.clienteId);
        if (!contatoId) throw new Error("loja sem contato no Bling (falta o CNPJ ou o cadastro)");
        const r = await criarInsistindo({
          contatoId,
          valor: l.previstoSite,
          vencimento: ate,
          historico: `FECHAMENTO ${de} a ${ate} - ${l.loja}`,
        });
        feitos.push({ loja: l.loja, ok: true, id: r.id });
      } catch (err) {
        feitos.push({
          loja: l.loja,
          ok: false,
          erro: err instanceof Error ? err.message : "falhou",
        });
      }
    }
    res.json({ total: feitos.length, ok: feitos.filter((x) => x.ok).length, feitos });
  } catch (err) {
    erro(res, err, "Falha ao espelhar o fechamento no Bling.");
  }
});

fabricaPedidosRouter.post("/fechamentos", async (req, res) => {
  const b = req.body ?? {};
  const de = String(b.de ?? "");
  const ate = String(b.ate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
    return res.status(400).json({ error: "Informe o período como AAAA-MM-DD." });
  }
  if (de > ate) return res.status(400).json({ error: "A data inicial é depois da final." });
  try {
    const obs = typeof b.observacao === "string" && b.observacao.trim() ? b.observacao.trim() : null;
    res.status(201).json(await gravarFechamento(de, ate, obs));
  } catch (err) {
    erro(res, err, "Falha ao gravar o fechamento.");
  }
});

fabricaPedidosRouter.delete("/fechamentos/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Id inválido." });
  try {
    await excluirFechamento(id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao excluir o fechamento.");
  }
});

fabricaPedidosRouter.get("/pagamentos", async (req, res) => {
  const limite = Number(req.query.limite);
  try {
    // o total vem junto: sem ele quem soma na tela soma errado e nao descobre
    const [pagamentos, resumo] = await Promise.all([
      listarPagamentos(Number.isInteger(limite) && limite > 0 ? limite : undefined),
      contarPagamentos(),
    ]);
    res.json({ pagamentos, total: resumo.total, valorTotal: resumo.valor });
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

fabricaPedidosRouter.put("/pagamentos/:id/antecipacao", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id invalido." });
  try {
    await marcarAntecipacao(id, (req.body ?? {}).antecipacao !== false);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao marcar o adiantamento.");
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

// Fica antes do GET "/:id" de propósito: registrada depois, o Express lê
// "apelidos" como id de pedido e devolve "Id inválido".
// Apelido de cliente: como o ERP escreve o nome dele.
//
// Mora neste router, e não no de clientes, porque quem cria apelido é quem está
// importando venda e vê o nome que não casou — exigir a permissão de cadastro
// de clientes pra isso travaria a importação na mão de quem só importa.
fabricaPedidosRouter.get("/apelidos", async (_req, res) => {
  try {
    res.json(await listarApelidos());
  } catch (err) {
    erro(res, err, "Falha ao listar os apelidos.");
  }
});

fabricaPedidosRouter.post("/apelidos", async (req, res) => {
  const b = req.body ?? {};
  const clienteId = Number(b.clienteId);
  if (!Number.isFinite(clienteId) || clienteId <= 0) {
    return res.status(400).json({ error: "Escolha o cliente." });
  }
  try {
    res.status(201).json(await criarApelido(clienteId, String(b.apelido ?? "")));
  } catch (err) {
    erro(res, err, "Falha ao gravar o apelido.");
  }
});

fabricaPedidosRouter.delete("/apelidos/:id", async (req, res) => {
  try {
    await excluirApelido(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao apagar o apelido.");
  }
});

// Apelido de SKU: como o ERP escreve o código do produto.
//
// Fica junto do apelido de cliente e pela mesma razão — quem cria é quem está
// importando venda e vê o código que não casou.
//
// Tem que vir antes do "/:id" logo abaixo: senão o Express casa "apelidos-sku"
// com o parâmetro e devolve "Id inválido". Mesma armadilha do "exportar" e do
// "idade-do-saldo".
fabricaPedidosRouter.get("/apelidos-sku", async (_req, res) => {
  try {
    res.json(await listarApelidosSku());
  } catch (err) {
    erro(res, err, "Falha ao listar os apelidos de SKU.");
  }
});

fabricaPedidosRouter.post("/apelidos-sku", async (req, res) => {
  const b = req.body ?? {};
  const produtoId = Number(b.produtoId);
  if (!Number.isFinite(produtoId) || produtoId <= 0) {
    return res.status(400).json({ error: "Escolha o produto." });
  }
  try {
    res.status(201).json(await criarApelidoSku(produtoId, String(b.apelido ?? "")));
  } catch (err) {
    erro(res, err, "Falha ao gravar o apelido de SKU.");
  }
});

fabricaPedidosRouter.delete("/apelidos-sku/:id", async (req, res) => {
  try {
    await excluirApelidoSku(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao apagar o apelido de SKU.");
  }
});

// Antes do "/:id" logo abaixo: senão o Express casa "custo-faltante" com o
// parâmetro e devolve "Id inválido". Mesma armadilha do "exportar", do
// "idade-do-saldo" e do "apelidos-sku".
// Apaga os pedidos do periodo pra ele ser refeito por uma fonte so. Tambem
// antes do "/:id".
fabricaPedidosRouter.post("/refazer-periodo", async (req, res) => {
  const b = req.body ?? {};
  const de = String(b.de ?? "");
  const ate = String(b.ate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
    return res.status(400).json({ error: "Informe o período como AAAA-MM-DD." });
  }
  try {
    res.json(await refazerPeriodo(de, ate, b.simular !== false));
  } catch (err) {
    erro(res, err, "Falha ao limpar o período.");
  }
});

fabricaPedidosRouter.post("/custo-faltante", async (req, res) => {
  const b = req.body ?? {};
  const de = String(b.de ?? "");
  const ate = String(b.ate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
    return res.status(400).json({ error: "Informe o período como AAAA-MM-DD." });
  }
  try {
    res.json(await preencherCustoFaltante(de, ate, b.simular !== false));
  } catch (err) {
    erro(res, err, "Falha ao preencher o custo dos pedidos.");
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

// Sobe a planilha como arquivo em vez de texto colado.
//
// Converte e devolve o texto — quem confere e quem importa continuam sendo as
// mesmas rotas. Duas mil linhas coladas na tela travam o navegador, e o
// fechamento de um mes passa disso.
const uploadPlanilha = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

fabricaPedidosRouter.post(
  "/vendas-planilha/arquivo",
  uploadPlanilha.single("arquivo"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Envie o arquivo." });
    try {
      const texto = await planilhaParaTexto(req.file.buffer, req.file.originalname);
      const origem =
        typeof req.body?.origem === "string" && req.body.origem.trim()
          ? req.body.origem.trim().toUpperCase()
          : "SHOPEE";
      const conf = await conferirPlanilhaVendas(texto, origem);
      res.json({
        ...conf,
        skusFaltando: skusFaltando(conf.linhas),
        clientesFaltando: clientesFaltando(conf.linhas),
        texto,
      });
    } catch (err) {
      erro(res, err, "Falha ao ler o arquivo.");
    }
  }
);

// Confere uma planilha de vendas de outro canal antes de virar pedido.
//
// A API do Mercado Livre enxerga 65% do que a fábrica vende; o resto é Shopee e
// venda direta. Só lê e classifica: nada é lançado aqui.
fabricaPedidosRouter.post("/vendas-planilha", async (req, res) => {
  const texto = typeof req.body?.texto === "string" ? req.body.texto : "";
  const origem = typeof req.body?.origem === "string" && req.body.origem.trim()
    ? req.body.origem.trim().toUpperCase()
    : "SHOPEE";
  if (!texto.trim()) return res.status(400).json({ error: "Cole as linhas da planilha." });
  try {
    const conf = await conferirPlanilhaVendas(texto, origem);
    // os SKUs que faltam vem junto da conferencia: sem isso o operador ve
    // "SKU nao cadastrado" espalhado por 200 linhas e tem que cacar quais sao
    res.json({
      ...conf,
      skusFaltando: skusFaltando(conf.linhas),
      clientesFaltando: clientesFaltando(conf.linhas),
    });
  } catch (err) {
    erro(res, err, "Falha ao ler a planilha.");
  }
});

// Lanca de verdade o que a conferencia marcou como pronto. Linha com problema
// nao entra: o operador cadastra o que falta e sobe de novo, e o que ja entrou
// e reconhecido pelo numero do pedido e nao duplica.
fabricaPedidosRouter.post("/vendas-planilha/importar", async (req, res) => {
  const texto = typeof req.body?.texto === "string" ? req.body.texto : "";
  const origem =
    typeof req.body?.origem === "string" && req.body.origem.trim()
      ? req.body.origem.trim().toUpperCase()
      : "SHOPEE";
  if (!texto.trim()) return res.status(400).json({ error: "Cole as linhas da planilha." });
  try {
    res.json(await importarPlanilhaVendas(texto, origem));
  } catch (err) {
    erro(res, err, "Falha ao importar a planilha.");
  }
});
