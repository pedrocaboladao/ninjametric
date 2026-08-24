import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchPedidos,
  criarPedido,
  atualizarPedido,
  definirStatusPedido,
  excluirPedido,
  fetchEstoqueProdutos,
  definirEstoqueMinimoProduto,
  fetchAjustesProduto,
  registrarAjusteProduto,
  excluirAjusteProduto,
  fetchContaCorrente,
  fetchIdadeDoSaldo,
  fetchCreditos,
  lancarAntecipacao,
  lancarCredito,
  definirPercentualBonificacao,
  excluirCredito,
  excluirProvisorios,
  fetchExtrato,
  fetchPagamentos,
  registrarPagamento,
  excluirPagamento,
  fetchDevolucoes,
  registrarDevolucao,
  marcarNotaCancelada,
  excluirDevolucao,
  registrarRessarcimento,
  definirCreditoDevolucao,
} from "../api/fabricaPedidos";
import { fetchFabricaClientes } from "../api/fabricaClientes";
import { fetchFabricaProdutos } from "../api/fabricaProdutos";
import type {
  Pedido,
  PedidoEntrada,
  StatusPedido,
  EstoqueProduto,
  AjusteProduto,
  ContaCorrente,
  IdadeSaldo,
  Credito,
  SaldoCredito,
  AlertaProvisorio,
  Pagamento,
  LinhaExtrato,
  Devolucao,
  CondicaoDevolucao,
  StatusRessarcimento,
  ConsolidadoRessarcimento,
} from "../types/fabricaPedidos";
import type { FabricaCliente } from "../types/fabricaClientes";
import type { FabricaProduto } from "../types/fabricaProdutos";
import { formatCurrency } from "../utils/format";
import { IconPlus, IconTrash } from "./icons";
import { BotaoExcluir } from "./BotaoExcluir";
import { BuscaSelecao } from "./BuscaSelecao";
import type { OrigemProduto } from "../types/fabricaProdutos";
import type { ItemBusca } from "./BuscaSelecao";

// aceita "1.234,5" e "1234.5" — o operador digita como fala
function num(v: string): number {
  return Number(String(v).replace(/\./g, "").replace(",", ".")) || 0;
}

function data(d: string): string {
  return d.split("-").reverse().join("/");
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

interface LinhaRascunho {
  produtoId: string;
  quantidade: string;
  precoUnitario: string;
}

const LINHA_VAZIA: LinhaRascunho = { produtoId: "", quantidade: "", precoUnitario: "" };

export function FabricaPedidos() {
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [clientes, setClientes] = useState<FabricaCliente[]>([]);
  const [produtos, setProdutos] = useState<FabricaProduto[]>([]);
  const [estoque, setEstoque] = useState<EstoqueProduto[]>([]);
  const [ajustes, setAjustes] = useState<AjusteProduto[]>([]);
  const [contaCorrente, setContaCorrente] = useState<ContaCorrente[]>([]);
  const [idade, setIdade] = useState<IdadeSaldo | null>(null);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [extrato, setExtrato] = useState<LinhaExtrato[] | null>(null);
  const [extratoDe, setExtratoDe] = useState<ContaCorrente | null>(null);
  const [devolucoes, setDevolucoes] = useState<Devolucao[]>([]);
  const [notasPendentes, setNotasPendentes] = useState(0);
  const [consolidado, setConsolidado] = useState<ConsolidadoRessarcimento | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aba, setAba] = useState<
    "pedidos" | "novo" | "estoque" | "fechamento" | "creditos" | "devolucoes"
  >("pedidos");

  // credito da loja: antecipacao paga adiantado e bonificacao de 3,5%
  const [creditos, setCreditos] = useState<Credito[]>([]);
  const [saldosCredito, setSaldosCredito] = useState<SaldoCredito[]>([]);
  const [alertasCredito, setAlertasCredito] = useState<AlertaProvisorio[]>([]);
  const [percentual, setPercentual] = useState(3.5);
  const [percentualEdit, setPercentualEdit] = useState("");
  const [antCliente, setAntCliente] = useState("");
  const [antValor, setAntValor] = useState("");
  const [antData, setAntData] = useState("");
  const [antObs, setAntObs] = useState("");

  // divida carregada: o que a loja ja devia quando o sistema comecou
  const [divCliente, setDivCliente] = useState("");
  const [divValor, setDivValor] = useState("");
  const [divData, setDivData] = useState("");

  // devolucao recebida no balcao
  const [devCliente, setDevCliente] = useState("");
  const [devProduto, setDevProduto] = useState("");
  const [devQtd, setDevQtd] = useState("");
  const [devCondicao, setDevCondicao] = useState<CondicaoDevolucao>("BOM");
  const [devCredito, setDevCredito] = useState("");
  const [devNota, setDevNota] = useState("");
  const [devRecebidoPor, setDevRecebidoPor] = useState("");
  const [devObs, setDevObs] = useState("");

  // recebimento: PIX no fechamento de terca
  const [pagCliente, setPagCliente] = useState("");
  const [pagValor, setPagValor] = useState("");
  const [pagData, setPagData] = useState("");
  const [pagObs, setPagObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  // filtro da lista
  const [filtroCliente, setFiltroCliente] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("");

  // rascunho do pedido
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [clienteId, setClienteId] = useState("");
  const [dataPedido, setDataPedido] = useState("");
  const [status, setStatus] = useState<StatusPedido>("ABERTO");
  const [observacao, setObservacao] = useState("");
  const [linhas, setLinhas] = useState<LinhaRascunho[]>([{ ...LINHA_VAZIA }]);

  // ajuste de estoque
  const [ajusteProdutoId, setAjusteProdutoId] = useState("");
  const [ajusteTipo, setAjusteTipo] = useState<"inventario" | "ajuste">("inventario");
  const [ajusteQtd, setAjusteQtd] = useState("");
  const [ajusteMotivo, setAjusteMotivo] = useState("");

  const carregar = useCallback(async () => {
    try {
      const [ps, cs, prs, es, as] = await Promise.all([
        fetchPedidos({
          clienteId: filtroCliente ? Number(filtroCliente) : undefined,
          status: (filtroStatus || undefined) as StatusPedido | undefined,
        }),
        fetchFabricaClientes(),
        fetchFabricaProdutos(),
        fetchEstoqueProdutos(),
        fetchAjustesProduto(),
      ]);
      const [cc, pg, dv, cr, id] = await Promise.all([
        fetchContaCorrente(),
        fetchPagamentos(),
        fetchDevolucoes(),
        fetchCreditos(),
        fetchIdadeDoSaldo(),
      ]);
      setContaCorrente(cc);
      setIdade(id);
      setCreditos(cr.creditos);
      setSaldosCredito(cr.saldos);
      setAlertasCredito(cr.alertas);
      setPercentual(cr.percentual);
      setPagamentos(pg);
      setDevolucoes(dv.devolucoes);
      setNotasPendentes(dv.notasPendentes);
      setConsolidado(dv.consolidado);
      setPedidos(ps);
      setClientes(cs);
      setProdutos(prs);
      setEstoque(es);
      setAjustes(as);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.");
      setPedidos([]);
    }
  }, [filtroCliente, filtroStatus]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const produtoPor = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);

  // Qual catalogo esta aberto na hora de escolher o item do pedido. Vazio = os
  // dois, que e como era antes de existir produto de revenda.
  const [origemItem, setOrigemItem] = useState<"" | OrigemProduto>("");
  const saldoPor = useMemo(() => new Map(estoque.map((e) => [e.produtoId, e])), [estoque]);

  const totais = useMemo(() => {
    const lista = (pedidos ?? []).filter((p) => p.status !== "CANCELADO");
    const total = lista.reduce((s, p) => s + p.total, 0);
    const custo = lista.reduce((s, p) => s + p.custoTotal, 0);
    return { total, custo, margem: total - custo, pedidos: lista.length };
  }, [pedidos]);

  const alertas = useMemo(() => estoque.filter((e) => e.abaixoDoMinimo), [estoque]);

  // o saldo entra como detalhe na busca porque a pergunta logo depois de achar
  // o produto e "tem quanto?"
  const itensProduto: ItemBusca[] = useMemo(
    () =>
      produtos
        .filter((p) => !origemItem || p.origem === origemItem)
        .map((p) => ({
          id: p.id,
          titulo: p.nome,
          codigo: p.sku,
          detalhe: saldoPor.has(p.id) ? `${saldoPor.get(p.id)!.saldo} em estoque` : null,
          ativo: p.ativo,
        })),
    [produtos, saldoPor, origemItem]
  );

  const contagemOrigem = useMemo(() => {
    const m = { FABRICA: 0, DISTRIBUIDORA: 0 };
    for (const p of produtos) if (p.ativo) m[p.origem] += 1;
    return m;
  }, [produtos]);

  const itensCliente: ItemBusca[] = useMemo(
    () =>
      clientes.map((c) => ({
        id: c.id,
        titulo: c.nome,
        codigo: c.cnpj,
        detalhe: c.tipo === "EXTERNO" ? "cliente de fora" : null,
        ativo: c.ativo,
      })),
    [clientes]
  );

  const itensEstoque: ItemBusca[] = useMemo(
    () =>
      estoque.map((e) => ({
        id: e.produtoId,
        titulo: e.nome,
        codigo: e.sku,
        detalhe: `saldo ${e.saldo}`,
      })),
    [estoque]
  );

  // total do rascunho, calculado enquanto digita
  const totalRascunho = useMemo(() => {
    return linhas.reduce((s, l) => {
      const p = produtoPor.get(Number(l.produtoId));
      if (!p) return s;
      const preco = l.precoUnitario ? num(l.precoUnitario) : p.precoVenda;
      return s + num(l.quantidade) * preco;
    }, 0);
  }, [linhas, produtoPor]);

  function novoPedido() {
    setEditandoId(null);
    setClienteId("");
    setDataPedido("");
    setStatus("ABERTO");
    setObservacao("");
    setLinhas([{ ...LINHA_VAZIA }]);
    setErro(null);
    setAba("novo");
  }

  function editar(p: Pedido) {
    setEditandoId(p.id);
    setClienteId(String(p.clienteId));
    setDataPedido(p.data);
    setStatus(p.status);
    setObservacao(p.observacao ?? "");
    setLinhas(
      p.itens.map((i) => ({
        produtoId: String(i.produtoId),
        quantidade: String(i.quantidade),
        precoUnitario: String(i.precoUnitario),
      }))
    );
    setErro(null);
    setAba("novo");
  }

  function mudarLinha(idx: number, campo: keyof LinhaRascunho, valor: string) {
    setLinhas((ls) => ls.map((l, i) => (i === idx ? { ...l, [campo]: valor } : l)));
  }

  // ao escolher o produto, traz o preço do cadastro pro campo — fica visível e
  // editável, porque a loja às vezes negocia
  function escolherProduto(idx: number, valor: string) {
    const p = produtoPor.get(Number(valor));
    setLinhas((ls) =>
      ls.map((l, i) =>
        i === idx
          ? { ...l, produtoId: valor, precoUnitario: p ? String(p.precoVenda) : l.precoUnitario }
          : l
      )
    );
  }

  // credito parado nas lojas: e desconto ja prometido, nao dinheiro da fabrica.
  // So o confirmado entra: o provisorio ainda pode cair no fim do mes.
  const totalCredito = useMemo(
    () => saldosCredito.reduce((t, c) => t + Math.max(0, c.saldo), 0),
    [saldosCredito]
  );
  const totalProvisorio = useMemo(
    () => saldosCredito.reduce((t, c) => t + c.provisorio, 0),
    [saldosCredito]
  );

  // saldo negativo e loja que pagou adiantado; nao abate a divida das outras
  const totalDevido = useMemo(
    () => contaCorrente.reduce((s, c) => s + Math.max(0, c.saldo), 0),
    [contaCorrente]
  );

  const itensClienteDevendo: ItemBusca[] = useMemo(
    () =>
      contaCorrente.map((c) => ({
        id: c.clienteId,
        titulo: c.clienteNome,
        detalhe: c.saldo > 0 ? `deve ${formatCurrency(c.saldo)}` : "em dia",
      })),
    [contaCorrente]
  );

  async function abrirExtrato(c: ContaCorrente) {
    if (extratoDe?.clienteId === c.clienteId) {
      setExtratoDe(null);
      setExtrato(null);
      return;
    }
    setExtratoDe(c);
    setExtrato(null);
    try {
      setExtrato(await fetchExtrato(c.clienteId));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar o extrato.");
    }
  }

  // Antecipação: a loja manda dinheiro antes de comprar. Vira saldo dela mais
  // os 3,5% — os dois lançamentos saem juntos do backend.
  async function antecipar() {
    const id = Number(antCliente);
    if (!Number.isInteger(id) || !id) return setErro("Escolha a loja.");
    const valor = num(antValor);
    if (valor <= 0) return setErro("Informe o valor antecipado.");
    try {
      const r = await lancarAntecipacao({
        clienteId: id,
        valor,
        data: antData || undefined,
        observacao: antObs.trim() || null,
      });
      setErro(null);
      setAviso(
        `Antecipação de ${formatCurrency(r.antecipacao)} registrada, mais ${formatCurrency(
          r.bonificacao
        )} de bonificação (${r.percentual}%). Crédito total de ${formatCurrency(
          r.antecipacao + r.bonificacao
        )} pra abater nas próximas compras.`
      );
      setAntValor("");
      setAntObs("");
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao lançar a antecipação.");
    }
  }

  async function usarCredito(saldo: SaldoCredito) {
    const texto = window.prompt(
      `Quanto do crédito de ${saldo.clienteNome} abater agora? Disponível: ${formatCurrency(
        saldo.saldo
      )}`,
      saldo.saldo.toFixed(2)
    );
    if (texto === null) return;
    const valor = num(texto);
    if (valor <= 0) return;
    if (valor > saldo.saldo + 0.005)
      return setErro(
        `A loja só tem ${formatCurrency(saldo.saldo)} de crédito. Deixar o saldo negativo esconderia uma dívida.`
      );
    try {
      await lancarCredito({
        clienteId: saldo.clienteId,
        valor,
        origem: "USO",
        observacao: "Abatido no fechamento",
      });
      setErro(null);
      setAviso(`${formatCurrency(valor)} de crédito abatido de ${saldo.clienteNome}.`);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao usar o crédito.");
    }
  }

  // D\u00edvida carregada: entra como cr\u00e9dito negativo, ent\u00e3o soma na conta
  // corrente sem inventar pedido nenhum \u2014 e fica fora do DRE, porque a venda
  // aconteceu em outro m\u00eas.
  async function lancarDivida() {
    const id = Number(divCliente);
    if (!Number.isInteger(id) || !id) return setErro("Escolha a loja.");
    const valor = num(divValor);
    if (valor <= 0) return setErro("Informe quanto a loja j\u00e1 devia.");
    try {
      await lancarCredito({
        clienteId: id,
        valor,
        origem: "SALDO_ANTERIOR",
        data: divData || undefined,
        observacao: "D\u00edvida carregada da planilha",
      });
      setErro(null);
      setAviso(
        `D\u00edvida carregada de ${formatCurrency(
          valor
        )} lan\u00e7ada. Entra na conta corrente e fica fora do DRE \u2014 a venda foi em outro m\u00eas.`
      );
      setDivValor("");
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao lan\u00e7ar a d\u00edvida.");
    }
  }

  async function derrubarProvisorio(a: AlertaProvisorio) {
    if (
      !window.confirm(
        `Excluir ${formatCurrency(a.provisorio)} de bonifica\u00e7\u00e3o provis\u00f3ria de ${
          a.clienteNome
        }? Ela ainda deve ${formatCurrency(a.devendo)} do m\u00eas ${a.mesMaisAntigo}.`
      )
    )
      return;
    try {
      const r = await excluirProvisorios(a.clienteId);
      setErro(null);
      setAviso(
        `${r.excluidos} cr\u00e9dito${r.excluidos > 1 ? "s" : ""} provis\u00f3rio${
          r.excluidos > 1 ? "s" : ""
        } de ${a.clienteNome} exclu\u00edd${r.excluidos > 1 ? "os" : "o"}.`
      );
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao excluir o cr\u00e9dito provis\u00f3rio.");
    }
  }

  async function salvarPercentual() {
    const p = num(percentualEdit);
    if (!Number.isFinite(p) || p < 0 || p > 100)
      return setErro("Percentual deve ficar entre 0 e 100.");
    try {
      await definirPercentualBonificacao(p);
      setPercentual(p);
      setPercentualEdit("");
      setErro(null);
      setAviso(
        `Bonificação agora é de ${p}%. Créditos já lançados não mudam — só vale daqui pra frente.`
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar o percentual.");
    }
  }

  async function apagarCredito(c: Credito) {
    if (!window.confirm(`Excluir o crédito de ${formatCurrency(c.valor)} de ${c.clienteNome}?`))
      return;
    try {
      await excluirCredito(c.id);
      setErro(null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao excluir o crédito.");
    }
  }

  async function receber() {
    const id = Number(pagCliente);
    if (!Number.isInteger(id) || !id) return setErro("Escolha a loja.");
    const valor = num(pagValor);
    if (valor <= 0) return setErro("Informe o valor recebido.");
    try {
      const r = await registrarPagamento({
        clienteId: id,
        valor,
        data: pagData || null,
        observacao: pagObs.trim() || null,
      });
      setAviso(
        r.saldo > 0.005
          ? `PIX registrado. Sobrou ${formatCurrency(r.saldo)} — carrega pra próxima semana. ${formatCurrency(
              r.bonificacao
            )} de bonificação guardada como PROVISÓRIA: não abate nada até ela quitar.`
          : r.confirmados > 0
            ? `PIX registrado, loja zerada. ${formatCurrency(
                r.bonificacao
              )} de bonificação mais ${r.confirmados} crédito${
                r.confirmados > 1 ? "s" : ""
              } provisório${r.confirmados > 1 ? "s" : ""} que agora é${
                r.confirmados > 1 ? "" : ""
              } dela de vez.`
            : r.bonificacao > 0
              ? `PIX registrado, loja zerada. Bonificação de ${formatCurrency(
                  r.bonificacao
                )} (${percentual}%) creditada pra próxima compra.`
              : "PIX registrado. A loja está zerada."
      );
      setPagValor("");
      setPagObs("");
      await carregar();
      if (extratoDe?.clienteId === id) setExtrato(await fetchExtrato(id));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao registrar o recebimento.");
    }
  }

  async function apagarPagamento(pg: Pagamento) {
    try {
      await excluirPagamento(pg.id);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao excluir.");
    }
  }

  // o padrao segue a regra da fabrica: valor cheio so quando o produto volta
  // inteiro. Avariado a loja ja recebe do Mercado Livre, e dar credito tambem
  // faria ela receber duas vezes pelo mesmo balde.
  const creditoSugerido = useMemo(() => {
    if (devCondicao !== "BOM") return 0;
    const p = produtoPor.get(Number(devProduto));
    return p ? p.precoVenda * num(devQtd) : 0;
  }, [devCondicao, devProduto, devQtd, produtoPor]);

  async function lancarDevolucao() {
    const cliente = Number(devCliente);
    if (!Number.isInteger(cliente) || !cliente) return setErro("Escolha a loja.");
    const produto = Number(devProduto);
    if (!Number.isInteger(produto) || !produto) return setErro("Escolha o produto.");
    const qtd = num(devQtd);
    if (qtd <= 0) return setErro("Quantidade deve ser maior que zero.");
    try {
      await registrarDevolucao({
        clienteId: cliente,
        produtoId: produto,
        quantidade: qtd,
        condicao: devCondicao,
        credito: devCredito === "" ? null : num(devCredito),
        notaFiscal: devNota.trim() || null,
        recebidoPor: devRecebidoPor.trim() || null,
        observacao: devObs.trim() || null,
      });
      setAviso(
        devCondicao === "BOM"
          ? "Devolucao registrada. Produto de volta no estoque e credito abatido no fechamento. Nao esqueca de cancelar a nota."
          : "Devolucao registrada sem credito — a loja recebe o ressarcimento do Mercado Livre. Nao esqueca de cancelar a nota."
      );
      setDevQtd("");
      setDevCredito("");
      setDevNota("");
      setDevObs("");
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao registrar a devolucao.");
    }
  }

  async function mudarRessarcimento(d: Devolucao, status: StatusRessarcimento) {
    try {
      // ao marcar recebido sem valor informado ainda, assume o valor cheio da
      // mercadoria: e o caso comum, e o funcionario corrige se veio parcial
      const valor =
        status === "RECEBIDO" && d.ressarcimentoValor === 0
          ? d.valorDaMercadoria
          : d.ressarcimentoValor;
      await registrarRessarcimento(d.id, {
        status,
        valor,
        data: status === "RECEBIDO" ? d.ressarcimentoData : null,
        protocolo: d.ressarcimentoProtocolo,
      });
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar o ressarcimento.");
    }
  }

  async function mudarValorRessarcimento(d: Devolucao, valor: string) {
    try {
      await registrarRessarcimento(d.id, {
        status: "RECEBIDO",
        valor: num(valor),
        data: d.ressarcimentoData,
        protocolo: d.ressarcimentoProtocolo,
      });
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar o valor.");
    }
  }

  async function mudarCredito(d: Devolucao, valor: string) {
    try {
      await definirCreditoDevolucao(d.id, num(valor));
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar o crédito.");
    }
  }

  async function alternarNota(d: Devolucao) {
    try {
      await marcarNotaCancelada(d.id, !d.notaCancelada);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao marcar a nota.");
    }
  }

  async function apagarDevolucao(d: Devolucao) {
    try {
      await excluirDevolucao(d.id);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao excluir.");
    }
  }

  async function salvar() {
    const itens = linhas
      .filter((l) => l.produtoId && num(l.quantidade) > 0)
      .map((l) => ({
        produtoId: Number(l.produtoId),
        quantidade: num(l.quantidade),
        precoUnitario: l.precoUnitario === "" ? null : num(l.precoUnitario),
      }));
    if (!clienteId) return setErro("Escolha o cliente.");
    if (!itens.length) return setErro("O pedido precisa de pelo menos um item com quantidade.");

    const entrada: PedidoEntrada = {
      clienteId: Number(clienteId),
      data: dataPedido || null,
      status,
      observacao: observacao.trim() || null,
      itens,
    };
    setSalvando(true);
    try {
      if (editandoId) await atualizarPedido(editandoId, entrada);
      else await criarPedido(entrada);
      setAviso(editandoId ? `Pedido ${editandoId} salvo.` : "Pedido lançado.");
      novoPedido();
      setAba("pedidos");
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar pedido.");
    } finally {
      setSalvando(false);
    }
  }

  async function trocarStatus(p: Pedido, novo: StatusPedido) {
    try {
      await definirStatusPedido(p.id, novo);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao mudar o status.");
    }
  }

  async function apagar(p: Pedido) {
    try {
      await excluirPedido(p.id);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao excluir.");
    }
  }

  async function salvarMinimo(e: EstoqueProduto, valor: string) {
    try {
      await definirEstoqueMinimoProduto(e.produtoId, num(valor));
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar mínimo.");
    }
  }

  async function lancarAjuste() {
    const id = Number(ajusteProdutoId);
    if (!Number.isInteger(id) || !id) return setErro("Escolha o produto.");
    const v = num(ajusteQtd);
    if (ajusteTipo === "ajuste" && v === 0) {
      return setErro("Informe a quantidade (positiva entra, negativa sai).");
    }
    try {
      const r = await registrarAjusteProduto({
        produtoId: id,
        tipo: ajusteTipo,
        quantidade: ajusteTipo === "ajuste" ? v : undefined,
        contado: ajusteTipo === "inventario" ? v : undefined,
        motivo: ajusteMotivo.trim() || null,
      });
      setAviso(
        ajusteTipo === "inventario" && r.diferenca !== undefined
          ? `Inventário registrado. Diferença de ${r.diferenca} em relação ao que o sistema tinha.`
          : "Ajuste registrado."
      );
      setAjusteQtd("");
      setAjusteMotivo("");
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao registrar.");
    }
  }

  async function apagarAjuste(a: AjusteProduto) {
    try {
      await excluirAjusteProduto(a.id);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao excluir.");
    }
  }

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <div className="financeiro-stat-label">FÁBRICA DISTRIBUIDORA</div>
          <h1>Pedidos de venda</h1>
          <p className="financeiro-td-mudo">
            A fábrica vendendo pras lojas do grupo e pra clientes de fora. Cada pedido baixa o
            estoque de produto acabado; pedido cancelado devolve. Preço e custo ficam gravados no
            item — a margem de um pedido antigo não muda quando a resina sobe.
          </p>
        </div>
        <div>
          <div className="financeiro-stat-label">
            {totais.pedidos} PEDIDO{totais.pedidos === 1 ? "" : "S"} · MARGEM{" "}
            {totais.total > 0 ? pct(totais.margem / totais.total) : "—"}
          </div>
          <div className="financeiro-stat-valor">{formatCurrency(totais.total)}</div>
        </div>
      </div>

      {erro && <p className="financeiro-td-mudo">{erro}</p>}
      {aviso && <p className="financeiro-td-mudo">{aviso}</p>}

      <div className="financeiro-filtros">
        {(["pedidos", "novo", "estoque", "fechamento", "creditos", "devolucoes"] as const).map((a) => (
          <button
            key={a}
            type="button"
            className={aba === a ? "btn-responder" : "btn-excluir"}
            onClick={() => (a === "novo" && aba !== "novo" ? novoPedido() : setAba(a))}
          >
            {a === "pedidos"
              ? "Pedidos"
              : a === "novo"
                ? editandoId
                  ? `Editando ${editandoId}`
                  : "Novo pedido"
                : a === "estoque"
                  ? `Estoque de produto${alertas.length ? ` (${alertas.length})` : ""}`
                  : a === "fechamento"
                    ? "Fechamento"
                    : a === "creditos"
                      ? `Créditos${saldosCredito.length ? ` (${saldosCredito.length})` : ""}`
                      : `Devoluções${notasPendentes ? ` (${notasPendentes} NF)` : ""}`}
          </button>
        ))}
      </div>

      {aba === "pedidos" && (
        <>
          <div className="financeiro-filtros">
            <BuscaSelecao
              itens={itensCliente}
              valor={filtroCliente ? Number(filtroCliente) : null}
              placeholder="Todos os clientes"
              onEscolher={(id) => setFiltroCliente(id ? String(id) : "")}
            />
            <select
              className="clonar-input fabricacao-input-pequeno"
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
            >
              <option value="">Todos os status</option>
              <option value="ABERTO">Aberto</option>
              <option value="ENTREGUE">Entregue</option>
              <option value="CANCELADO">Cancelado</option>
            </select>
            <button type="button" className="btn-responder" onClick={novoPedido}>
              <IconPlus size={14} /> Novo pedido
            </button>
          </div>

          <div className="financeiro-tabela-wrap">
            <table className="financeiro-tabela">
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>DATA</th>
                  <th>CLIENTE</th>
                  <th>ITENS</th>
                  <th className="financeiro-th-numero">TOTAL</th>
                  <th className="financeiro-th-numero">CUSTO</th>
                  <th className="financeiro-th-numero">MARGEM</th>
                  <th>STATUS</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pedidos === null && (
                  <tr>
                    <td colSpan={9}>Carregando…</td>
                  </tr>
                )}
                {pedidos !== null && !pedidos.length && (
                  <tr>
                    <td colSpan={9}>Nenhum pedido lançado.</td>
                  </tr>
                )}
                {(pedidos ?? []).map((p) => (
                  <tr key={p.id} style={p.status === "CANCELADO" ? { opacity: 0.5 } : undefined}>
                    <td>
                      <button
                        type="button"
                        className="fabricacao-envase-nome-editavel"
                        onClick={() => editar(p)}
                      >
                        {p.id}
                      </button>
                    </td>
                    <td className="financeiro-td-mudo">{data(p.data)}</td>
                    <td>{p.clienteNome}</td>
                    <td className="financeiro-td-mudo">
                      {p.itens.length === 1
                        ? `${p.itens[0].quantidade}× ${p.itens[0].produtoNome}`
                        : `${p.itens.length} itens`}
                    </td>
                    <td className="financeiro-th-numero">{formatCurrency(p.total)}</td>
                    <td className="financeiro-th-numero financeiro-td-mudo">
                      {formatCurrency(p.custoTotal)}
                    </td>
                    <td className="financeiro-th-numero">
                      {formatCurrency(p.margemContribuicao)}{" "}
                      <span className="financeiro-td-mudo">{pct(p.percentualLucro)}</span>
                    </td>
                    <td>
                      <select
                        className="clonar-input fabricacao-input-pequeno"
                        value={p.status}
                        onChange={(e) => void trocarStatus(p, e.target.value as StatusPedido)}
                      >
                        <option value="ABERTO">Aberto</option>
                        <option value="ENTREGUE">Entregue</option>
                        <option value="CANCELADO">Cancelado</option>
                      </select>
                    </td>
                    <td>
                      <BotaoExcluir onConfirmar={() => void apagar(p)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="financeiro-td-mudo">
            Só o pedido cancelado não baixa estoque. Aberto e entregue baixam igual — o produto já
            foi separado, não está mais disponível pra outra loja.
          </p>
        </>
      )}

      {aba === "novo" && (
        <>
          <div className="financeiro-filtros">
            <BuscaSelecao
              itens={itensCliente}
              valor={clienteId ? Number(clienteId) : null}
              placeholder="Buscar cliente"
              onEscolher={(id) => setClienteId(id ? String(id) : "")}
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              type="date"
              value={dataPedido}
              onChange={(e) => setDataPedido(e.target.value)}
            />
            <select
              className="clonar-input fabricacao-input-pequeno"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusPedido)}
            >
              <option value="ABERTO">Aberto</option>
              <option value="ENTREGUE">Entregue</option>
              <option value="CANCELADO">Cancelado</option>
            </select>
            <input
              className="clonar-input"
              placeholder="Observação (opcional)"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
            />
          </div>

          <div className="origem-abas">
            {(["", "FABRICA", "DISTRIBUIDORA"] as const).map((o) => (
              <button
                key={o || "todos"}
                type="button"
                className={origemItem === o ? "btn-responder" : "btn-excluir"}
                onClick={() => setOrigemItem(o)}
              >
                {o === "" ? "Todos" : o === "FABRICA" ? "Produto fábrica" : "Produto distribuição"}
                {o !== "" && ` (${contagemOrigem[o]})`}
              </button>
            ))}
            <span className="financeiro-td-mudo">
              escolha o catálogo antes de buscar — evita lançar um pelo outro
            </span>
          </div>

          <div className="financeiro-tabela-wrap financeiro-tabela-wrap-transbordo">
            <table className="financeiro-tabela">
              <thead>
                <tr>
                  <th>PRODUTO</th>
                  <th className="financeiro-th-numero">EM ESTOQUE</th>
                  <th className="financeiro-th-numero">QUANTIDADE</th>
                  <th className="financeiro-th-numero">PREÇO UN.</th>
                  <th className="financeiro-th-numero">TOTAL</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, idx) => {
                  const p = produtoPor.get(Number(l.produtoId));
                  const saldo = saldoPor.get(Number(l.produtoId));
                  const preco = l.precoUnitario ? num(l.precoUnitario) : (p?.precoVenda ?? 0);
                  const qtd = num(l.quantidade);
                  const faltando = saldo !== undefined && qtd > saldo.saldo;
                  return (
                    <tr key={idx}>
                      <td>
                        <BuscaSelecao
                          itens={itensProduto}
                          valor={l.produtoId ? Number(l.produtoId) : null}
                          placeholder={
                            origemItem === "FABRICA"
                              ? "Buscar produto fabricado"
                              : origemItem === "DISTRIBUIDORA"
                                ? "Buscar produto de revenda"
                                : "Buscar por nome ou SKU"
                          }
                          onEscolher={(id) => escolherProduto(idx, id ? String(id) : "")}
                        />
                      </td>
                      <td className={faltando ? "financeiro-th-numero" : "financeiro-th-numero financeiro-td-mudo"}>
                        {saldo ? saldo.saldo : "—"}
                        {faltando && " ⚠"}
                      </td>
                      <td className="financeiro-th-numero">
                        <input
                          className="clonar-input fabricacao-input-pequeno"
                          placeholder="Qtd"
                          value={l.quantidade}
                          onChange={(e) => mudarLinha(idx, "quantidade", e.target.value)}
                        />
                      </td>
                      <td className="financeiro-th-numero">
                        <input
                          className="clonar-input fabricacao-input-pequeno"
                          placeholder={p ? String(p.precoVenda) : "Preço"}
                          value={l.precoUnitario}
                          onChange={(e) => mudarLinha(idx, "precoUnitario", e.target.value)}
                        />
                      </td>
                      <td className="financeiro-th-numero">{formatCurrency(qtd * preco)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-excluir"
                          onClick={() => setLinhas((ls) => (ls.length > 1 ? ls.filter((_, i) => i !== idx) : ls))}
                          title="Remover linha"
                        >
                          <IconTrash size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="financeiro-filtros">
            <button
              type="button"
              className="btn-excluir"
              onClick={() => setLinhas((ls) => [...ls, { ...LINHA_VAZIA }])}
            >
              <IconPlus size={14} /> Mais um item
            </button>
            <div className="financeiro-stat-valor">{formatCurrency(totalRascunho)}</div>
            <button type="button" className="btn-responder" onClick={() => void salvar()} disabled={salvando}>
              {editandoId ? "Salvar pedido" : "Lançar pedido"}
            </button>
            {editandoId && (
              <button type="button" className="btn-excluir" onClick={novoPedido}>
                Cancelar edição
              </button>
            )}
          </div>
          <p className="financeiro-td-mudo">
            O preço vem do cadastro do produto e fica editável — a loja às vezes negocia. O ⚠ avisa
            que não tem tanto em estoque, mas não impede o lançamento: o pedido pode ser separado
            antes da produção terminar.
          </p>
        </>
      )}

      {aba === "estoque" && (
        <>
          <div className="financeiro-tabela-wrap">
            <table className="financeiro-tabela">
              <thead>
                <tr>
                  <th>PRODUTO</th>
                  <th className="financeiro-th-numero">PRODUZIDO</th>
                  <th className="financeiro-th-numero">VENDIDO</th>
                  <th className="financeiro-th-numero">DEVOLVIDO</th>
                  <th className="financeiro-th-numero">AJUSTES</th>
                  <th className="financeiro-th-numero">SALDO</th>
                  <th className="financeiro-th-numero">MÍNIMO</th>
                  <th>SITUAÇÃO</th>
                  <th className="financeiro-th-numero">VALOR</th>
                </tr>
              </thead>
              <tbody>
                {!estoque.length && (
                  <tr>
                    <td colSpan={9}>Nenhum produto cadastrado.</td>
                  </tr>
                )}
                {estoque.map((e) => (
                  <tr key={e.produtoId}>
                    <td>
                      {e.nome}
                      {e.semCadastroCompleto && (
                        <span className="financeiro-td-mudo"> · sem fórmula ou embalagem</span>
                      )}
                    </td>
                    <td className="financeiro-th-numero financeiro-td-mudo">{e.produzido || "—"}</td>
                    <td className="financeiro-th-numero financeiro-td-mudo">{e.vendido || "—"}</td>
                    <td className="financeiro-th-numero financeiro-td-mudo">{e.devolvido || "—"}</td>
                    <td className="financeiro-th-numero financeiro-td-mudo">{e.ajustes || "—"}</td>
                    <td className="financeiro-th-numero">{e.saldo}</td>
                    <td className="financeiro-th-numero">
                      <input
                        className="clonar-input fabricacao-input-pequeno"
                        defaultValue={e.estoqueMinimo || ""}
                        placeholder="—"
                        onBlur={(ev) => {
                          if (num(ev.target.value) !== e.estoqueMinimo) void salvarMinimo(e, ev.target.value);
                        }}
                      />
                    </td>
                    <td className={e.abaixoDoMinimo ? undefined : "financeiro-td-mudo"}>
                      {e.estoqueMinimo <= 0 ? "sem controle" : e.abaixoDoMinimo ? "PRODUZIR" : "ok"}
                    </td>
                    <td className="financeiro-th-numero financeiro-td-mudo">
                      {formatCurrency(e.valorEmEstoque)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="financeiro-td-mudo">
            Produzido vem dos envases dos lotes: um lote que encheu 40 baldes de 18 kg produziu 40
            unidades daquele produto. Produto sem fórmula ou sem embalagem no cadastro não tem como
            ser produzido automaticamente — aparece zerado em vez de sumir, pra ficar visível.
          </p>

          <div className="financeiro-filtros">
            <BuscaSelecao
              itens={itensEstoque}
              valor={ajusteProdutoId ? Number(ajusteProdutoId) : null}
              placeholder="Buscar produto por nome ou SKU"
              onEscolher={(id) => setAjusteProdutoId(id ? String(id) : "")}
            />
            <select
              className="clonar-input fabricacao-input-pequeno"
              value={ajusteTipo}
              onChange={(e) => setAjusteTipo(e.target.value as "inventario" | "ajuste")}
            >
              <option value="inventario">Inventário (contei)</option>
              <option value="ajuste">Ajuste (entra/sai)</option>
            </select>
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder={ajusteTipo === "inventario" ? "Quantos tem" : "± quantidade"}
              value={ajusteQtd}
              onChange={(e) => setAjusteQtd(e.target.value)}
            />
            <input
              className="clonar-input"
              placeholder="Motivo (opcional)"
              value={ajusteMotivo}
              onChange={(e) => setAjusteMotivo(e.target.value)}
            />
            <button type="button" className="btn-responder" onClick={() => void lancarAjuste()}>
              <IconPlus size={14} /> Registrar
            </button>
          </div>

          <div className="financeiro-tabela-wrap">
            <table className="financeiro-tabela">
              <thead>
                <tr>
                  <th>DATA</th>
                  <th>PRODUTO</th>
                  <th className="financeiro-th-numero">QUANTIDADE</th>
                  <th>MOTIVO</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {!ajustes.length && (
                  <tr>
                    <td colSpan={5}>Nenhum ajuste registrado.</td>
                  </tr>
                )}
                {ajustes.map((a) => (
                  <tr key={a.id}>
                    <td className="financeiro-td-mudo">{data(a.data)}</td>
                    <td>{a.produtoNome}</td>
                    <td className="financeiro-th-numero">
                      {a.quantidade > 0 ? "+" : ""}
                      {a.quantidade}
                    </td>
                    <td className="financeiro-td-mudo">{a.motivo ?? "—"}</td>
                    <td>
                      <BotaoExcluir onConfirmar={() => void apagarAjuste(a)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {aba === "fechamento" && (
        <>
          <div className="financeiro-topo">
            <div>
              <h2>Fechamento e recebimento</h2>
              <p className="financeiro-td-mudo">
                Não existe conta a receber digitada: o que a loja deve sai dos pedidos menos os
                PIX recebidos. Pagou R$ 90.000 de R$ 100.000? Os R$ 10.000 continuam rolando pra
                semana que vem sozinhos — sem escolher qual pedido foi quitado primeiro.
              </p>
            </div>
            <div>
              <div className="financeiro-stat-label">AS LOJAS DEVEM</div>
              <div className="financeiro-stat-valor">{formatCurrency(totalDevido)}</div>
            </div>
          </div>

          <div className="financeiro-filtros">
            <BuscaSelecao
              itens={itensClienteDevendo}
              valor={pagCliente ? Number(pagCliente) : null}
              placeholder="Buscar loja"
              onEscolher={(id) => setPagCliente(id ? String(id) : "")}
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder="Valor recebido"
              value={pagValor}
              onChange={(e) => setPagValor(e.target.value)}
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              type="date"
              value={pagData}
              onChange={(e) => setPagData(e.target.value)}
            />
            <input
              className="clonar-input"
              placeholder="Observação (opcional)"
              value={pagObs}
              onChange={(e) => setPagObs(e.target.value)}
            />
            <button type="button" className="btn-responder" onClick={() => void receber()}>
              <IconPlus size={14} /> Receber PIX
            </button>
          </div>

          <div className="financeiro-tabela-wrap">
            <table className="financeiro-tabela">
              <thead>
                <tr>
                  <th>LOJA</th>
                  <th className="financeiro-th-numero">PEGOU</th>
                  <th className="financeiro-th-numero">PAGOU</th>
                  <th className="financeiro-th-numero">DEVOLUÇÃO</th>
                  <th className="financeiro-th-numero">EM CONTA</th>
                  <th className="financeiro-th-numero">DEVE</th>
                  <th>ÚLTIMO PEDIDO</th>
                  <th>ÚLTIMO PIX</th>
                </tr>
              </thead>
              <tbody>
                {!contaCorrente.length && (
                  <tr>
                    <td colSpan={8}>Nenhum cliente cadastrado.</td>
                  </tr>
                )}
                {contaCorrente
                  .slice()
                  // quem deve mais aparece primeiro: e a ordem em que se cobra
                  .sort((a, b) => b.saldo - a.saldo)
                  .map((c) => (
                    <tr key={c.clienteId}>
                      <td>
                        <button
                          type="button"
                          className="fabricacao-envase-nome-editavel"
                          onClick={() => void abrirExtrato(c)}
                        >
                          {c.clienteNome}
                        </button>
                      </td>
                      <td className="financeiro-th-numero financeiro-td-mudo">
                        {c.comprado ? formatCurrency(c.comprado) : "—"}
                      </td>
                      <td className="financeiro-th-numero financeiro-td-mudo">
                        {c.pago ? formatCurrency(c.pago) : "—"}
                      </td>
                      <td className="financeiro-th-numero financeiro-td-mudo">
                        {c.credito ? formatCurrency(c.credito) : "—"}
                      </td>
                      <td className="financeiro-th-numero financeiro-td-mudo">
                        {c.creditoConta ? formatCurrency(c.creditoConta) : "—"}
                      </td>
                      <td className={c.saldo > 0.005 ? "financeiro-th-numero" : "financeiro-th-numero financeiro-td-mudo"}>
                        {Math.abs(c.saldo) < 0.005
                          ? "em dia"
                          : c.saldo > 0
                            ? formatCurrency(c.saldo)
                            : `${formatCurrency(-c.saldo)} adiantado`}
                      </td>
                      <td className="financeiro-td-mudo">
                        {c.ultimoPedido ? data(c.ultimoPedido) : "—"}
                      </td>
                      <td className="financeiro-td-mudo">
                        {c.ultimoPagamento ? data(c.ultimoPagamento) : "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {idade && idade.clientes.length > 0 && (
            <>
              <h2>Idade do saldo</h2>
              <p className="financeiro-td-mudo">
                Há quanto tempo cada loja está devendo. A conta corrente diz quanto, nunca desde
                quando — pagamento parcial é a regra aqui e ninguém escolhe qual pedido foi
                quitado. Então vale a convenção que a fábrica já pratica:{" "}
                <strong>o mais velho é pago primeiro</strong>. O que sobra sem cobertura é o que
                está velho. Vencimento em {idade.diasAteVencer} dias, que é o ciclo: pega em sete,
                paga no oitavo.
              </p>

              <div className="contas-cartoes">
                <div className="contas-cartao">
                  <span className="financeiro-stat-label">A VENCER</span>
                  <strong>{formatCurrency(idade.totais.aVencer)}</strong>
                </div>
                {idade.totais.faixas.map((f) => (
                  <div
                    key={f.rotulo}
                    className={f.valor > 0 ? "contas-cartao contas-cartao-alerta" : "contas-cartao"}
                  >
                    <span className="financeiro-stat-label">{f.rotulo.toUpperCase()}</span>
                    <strong>{f.valor ? formatCurrency(f.valor) : "—"}</strong>
                  </div>
                ))}
                <div className="contas-cartao">
                  <span className="financeiro-stat-label">TOTAL</span>
                  <strong>{formatCurrency(idade.totais.total)}</strong>
                </div>
              </div>

              <div className="financeiro-tabela-wrap">
                <table className="financeiro-tabela">
                  <thead>
                    <tr>
                      <th>LOJA</th>
                      <th>QUEM PAGA</th>
                      <th className="financeiro-th-numero">A VENCER</th>
                      {idade.totais.faixas.map((f) => (
                        <th key={f.rotulo} className="financeiro-th-numero">
                          {f.rotulo.toUpperCase()}
                        </th>
                      ))}
                      <th className="financeiro-th-numero">TOTAL</th>
                      <th>ATRASO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {idade.clientes.map((c) => (
                      <tr key={c.clienteId}>
                        <td>{c.clienteNome}</td>
                        <td className="financeiro-td-mudo">{c.clientePaiNome ?? "ela mesma"}</td>
                        <td className="financeiro-th-numero financeiro-td-mudo">
                          {c.aVencer ? formatCurrency(c.aVencer) : "—"}
                        </td>
                        {c.faixas.map((f) => (
                          <td key={f.rotulo} className="financeiro-th-numero financeiro-td-mudo">
                            {f.valor ? formatCurrency(f.valor) : "—"}
                          </td>
                        ))}
                        <td className="financeiro-th-numero">{formatCurrency(c.total)}</td>
                        <td className={c.diasMaisVelho > 30 ? undefined : "financeiro-td-mudo"}>
                          {c.diasMaisVelho > 0
                            ? `${c.diasMaisVelho} dia${c.diasMaisVelho === 1 ? "" : "s"}`
                            : "em dia"}
                          {c.maisVelho && c.diasMaisVelho > 0 && (
                            <span className="financeiro-td-mudo"> · desde {data(c.maisVelho)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {extratoDe && (
            <>
              <h2>Extrato — {extratoDe.clienteNome}</h2>
              <div className="financeiro-tabela-wrap">
                <table className="financeiro-tabela">
                  <thead>
                    <tr>
                      <th>DATA</th>
                      <th>LANÇAMENTO</th>
                      <th className="financeiro-th-numero">VALOR</th>
                      <th className="financeiro-th-numero">SALDO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extrato === null && (
                      <tr>
                        <td colSpan={4}>Carregando…</td>
                      </tr>
                    )}
                    {extrato !== null && !extrato.length && (
                      <tr>
                        <td colSpan={4}>Nada lançado pra esta loja ainda.</td>
                      </tr>
                    )}
                    {(extrato ?? []).map((l) => (
                      <tr key={`${l.tipo}-${l.referencia}`}>
                        <td className="financeiro-td-mudo">{data(l.data)}</td>
                        <td>{l.descricao}</td>
                        <td className="financeiro-th-numero">
                          {l.valor > 0 ? "" : "−"}
                          {formatCurrency(Math.abs(l.valor))}
                        </td>
                        <td className="financeiro-th-numero">{formatCurrency(l.saldo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <h2>PIX recebidos</h2>
          <div className="financeiro-tabela-wrap">
            <table className="financeiro-tabela">
              <thead>
                <tr>
                  <th>DATA</th>
                  <th>LOJA</th>
                  <th className="financeiro-th-numero">VALOR</th>
                  <th>OBSERVAÇÃO</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {!pagamentos.length && (
                  <tr>
                    <td colSpan={5}>Nenhum recebimento registrado.</td>
                  </tr>
                )}
                {pagamentos.map((pg) => (
                  <tr key={pg.id}>
                    <td className="financeiro-td-mudo">{data(pg.data)}</td>
                    <td>{pg.clienteNome}</td>
                    <td className="financeiro-th-numero">{formatCurrency(pg.valor)}</td>
                    <td className="financeiro-td-mudo">{pg.observacao ?? "PIX"}</td>
                    <td>
                      <BotaoExcluir onConfirmar={() => void apagarPagamento(pg)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {aba === "creditos" && (
        <>
          <div className="financeiro-topo">
            <div>
              <h2>Crédito das lojas</h2>
              <p className="financeiro-td-mudo">
                Duas coisas viram crédito: a loja <strong>antecipar</strong> dinheiro antes de
                comprar, e <strong>pagar</strong>, que rende {percentual}% sobre o valor pago.
                Pagou 90 de 100 e já leva os {percentual}% dos 90 — mas como{" "}
                <strong>provisório</strong>, e provisório <strong>não abate nada</strong>: fica
                guardado até ela quitar. Quitou, vira dela e passa a abater. Virou o mês devendo?
                O alerta acende e o crédito pode ser excluído — mas se você esquecer de clicar,
                ela também não leva. Nada disso é desconto sobre a venda: a venda saiu pelo valor
                cheio, o crédito só muda de onde vem o dinheiro da próxima.
              </p>
            </div>
            <div>
              <div className="financeiro-stat-label">CRÉDITO QUE ABATE</div>
              <div className="financeiro-stat-valor">{formatCurrency(totalCredito)}</div>
              {totalProvisorio > 0 && (
                <div className="financeiro-td-mudo">
                  + {formatCurrency(totalProvisorio)} provisório, parado
                </div>
              )}
            </div>
          </div>

          {alertasCredito.length > 0 && (
            <div className="credito-alerta">
              <p>
                <strong>
                  {alertasCredito.filter((a) => a.venceu).length > 0
                    ? "Bonificação provisória vencida"
                    : "Bonificação provisória em aberto"}
                </strong>{" "}
                — estas lojas levaram os {percentual}% sobre o que pagaram, mas ainda não
                quitaram. <strong>Nada disso está abatendo</strong> — o provisório fica parado
                até ela quitar. Quem virou o mês devendo não fechou o anterior: aí o crédito
                pode cair de vez. Se você não clicar, ele só continua parado.
              </p>
              <table className="financeiro-tabela">
                <thead>
                  <tr>
                    <th>LOJA</th>
                    <th>DESDE</th>
                    <th className="financeiro-th-numero">PROVISÓRIO</th>
                    <th className="financeiro-th-numero">AINDA DEVE</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {alertasCredito.map((a) => (
                    <tr key={a.clienteId}>
                      <td>{a.clienteNome}</td>
                      <td className="financeiro-td-mudo">
                        {a.mesMaisAntigo}
                        {a.venceu && <strong> · virou o mês</strong>}
                      </td>
                      <td className="financeiro-th-numero">{formatCurrency(a.provisorio)}</td>
                      <td className="financeiro-th-numero financeiro-td-mudo">
                        {formatCurrency(a.devendo)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className={a.venceu ? "btn-responder" : "btn-excluir"}
                          onClick={() => void derrubarProvisorio(a)}
                        >
                          Excluir crédito
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="financeiro-filtros">
            <BuscaSelecao
              itens={itensCliente}
              valor={antCliente ? Number(antCliente) : null}
              placeholder="Buscar loja"
              onEscolher={(id) => setAntCliente(id ? String(id) : "")}
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder="Valor antecipado"
              value={antValor}
              onChange={(e) => setAntValor(e.target.value)}
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              type="date"
              value={antData}
              onChange={(e) => setAntData(e.target.value)}
            />
            <input
              className="clonar-input"
              placeholder="Observação (opcional)"
              value={antObs}
              onChange={(e) => setAntObs(e.target.value)}
            />
            <button type="button" className="btn-responder" onClick={() => void antecipar()}>
              <IconPlus size={14} /> Lançar antecipação
            </button>
          </div>

          {antValor.trim() !== "" && num(antValor) > 0 && (
            <p className="financeiro-td-mudo">
              Vai gerar {formatCurrency(num(antValor))} de antecipação +{" "}
              {formatCurrency((num(antValor) * percentual) / 100)} de bonificação ({percentual}%) ={" "}
              <strong>{formatCurrency(num(antValor) * (1 + percentual / 100))}</strong> de crédito.
            </p>
          )}

          <div className="financeiro-filtros">
            <span className="financeiro-stat-label">DÍVIDA CARREGADA</span>
            <BuscaSelecao
              itens={itensCliente}
              valor={divCliente ? Number(divCliente) : null}
              placeholder="Buscar loja"
              onEscolher={(id) => setDivCliente(id ? String(id) : "")}
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder="Quanto já devia"
              value={divValor}
              onChange={(e) => setDivValor(e.target.value)}
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              type="date"
              value={divData}
              onChange={(e) => setDivData(e.target.value)}
            />
            <button type="button" className="btn-excluir" onClick={() => void lancarDivida()}>
              Lançar dívida
            </button>
          </div>
          <p className="financeiro-td-mudo">
            O que a loja já devia antes do sistema. Entra na conta corrente e{" "}
            <strong>fica fora do DRE</strong> — a venda aconteceu em outro mês, contá-la agora
            inventaria receita que não é deste período.
          </p>

          <div className="financeiro-filtros">
            <span className="financeiro-stat-label">BONIFICAÇÃO POR PAGAR EM DIA</span>
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder={String(percentual)}
              value={percentualEdit}
              onChange={(e) => setPercentualEdit(e.target.value)}
            />
            <span className="financeiro-td-mudo">%</span>
            <button
              type="button"
              className="btn-excluir"
              onClick={() => void salvarPercentual()}
              disabled={percentualEdit.trim() === ""}
            >
              Salvar
            </button>
          </div>

          <div className="financeiro-tabela-wrap">
            <table className="financeiro-tabela">
              <thead>
                <tr>
                  <th>LOJA</th>
                  <th>QUEM PAGA</th>
                  <th className="financeiro-th-numero">ANTECIPADO</th>
                  <th className="financeiro-th-numero">BONIFICADO</th>
                  <th className="financeiro-th-numero">DÍVIDA ANTERIOR</th>
                  <th className="financeiro-th-numero">AJUSTES</th>
                  <th className="financeiro-th-numero">USADO</th>
                  <th className="financeiro-th-numero">PROVISÓRIO</th>
                  <th className="financeiro-th-numero">SALDO QUE ABATE</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {!saldosCredito.length && (
                  <tr>
                    <td colSpan={10}>
                      Nenhuma loja com crédito ou dívida carregada. Aparece aqui quando alguém
                      antecipar, pagar, ou receber o saldo de abertura.
                    </td>
                  </tr>
                )}
                {saldosCredito.map((sc) => (
                  <tr key={sc.clienteId}>
                    <td>{sc.clienteNome}</td>
                    <td className="financeiro-td-mudo">{sc.clientePaiNome ?? "ela mesma"}</td>
                    <td className="financeiro-th-numero financeiro-td-mudo">
                      {sc.antecipado ? formatCurrency(sc.antecipado) : "\u2014"}
                    </td>
                    <td className="financeiro-th-numero financeiro-td-mudo">
                      {sc.bonificado ? formatCurrency(sc.bonificado) : "\u2014"}
                    </td>
                    <td className="financeiro-th-numero financeiro-td-mudo">
                      {sc.anterior ? formatCurrency(sc.anterior) : "\u2014"}
                    </td>
                    <td className="financeiro-th-numero financeiro-td-mudo">
                      {sc.ajuste ? formatCurrency(sc.ajuste) : "\u2014"}
                    </td>
                    <td className="financeiro-th-numero financeiro-td-mudo">
                      {sc.usado ? formatCurrency(sc.usado) : "\u2014"}
                    </td>
                    <td className="financeiro-th-numero financeiro-td-mudo">
                      {sc.provisorio ? formatCurrency(sc.provisorio) : "—"}
                    </td>
                    <td className="financeiro-th-numero">{formatCurrency(sc.saldo)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-excluir"
                        onClick={() => void usarCredito(sc)}
                        disabled={sc.saldo <= 0.005}
                      >
                        Abater
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Lançamentos</h3>
          <div className="financeiro-tabela-wrap">
            <table className="financeiro-tabela">
              <thead>
                <tr>
                  <th>DATA</th>
                  <th>LOJA</th>
                  <th>ORIGEM</th>
                  <th className="financeiro-th-numero">VALOR</th>
                  <th>OBSERVAÇÃO</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {!creditos.length && (
                  <tr>
                    <td colSpan={6}>Nenhum lançamento ainda.</td>
                  </tr>
                )}
                {creditos.map((c) => (
                  <tr key={c.id}>
                    <td className="financeiro-td-mudo">{data(c.data)}</td>
                    <td>{c.clienteNome}</td>
                    <td className="financeiro-td-mudo">
                      {c.origem === "ANTECIPACAO"
                        ? "Antecipação"
                        : c.origem === "BONIFICACAO"
                          ? "Bonificação"
                          : c.origem === "USO"
                            ? "Abatido"
                            : c.origem === "SALDO_ANTERIOR"
                              ? "Dívida carregada"
                              : "Ajuste"}
                      {c.provisorio && <strong> · provisório</strong>}
                    </td>
                    <td className="financeiro-th-numero">{formatCurrency(c.valor)}</td>
                    <td className="financeiro-td-mudo">{c.observacao ?? "\u2014"}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-excluir"
                        onClick={() => void apagarCredito(c)}
                      >
                        Excluir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {aba === "devolucoes" && (
        <>
          <div className="financeiro-topo">
            <div>
              <h2>Devoluções</h2>
              <p className="financeiro-td-mudo">
                O cliente não quis, não estava em casa ou o pedido extraviou, e o produto volta pra
                loja e da loja pra cá. Produto <strong>inteiro</strong> volta pro estoque e gera
                crédito abatido no fechamento. <strong>Estourado</strong> e{" "}
                <strong>quebrado</strong> não geram crédito: a loja pede ressarcimento ao Mercado
                Livre e recebe direto na conta dela — dar crédito também faria ela receber duas
                vezes pelo mesmo balde.
              </p>
            </div>
            {notasPendentes > 0 && (
              <div>
                <div className="financeiro-stat-label">NOTAS PRA CANCELAR</div>
                <div className="financeiro-stat-valor">{notasPendentes}</div>
              </div>
            )}
          </div>

          {consolidado && consolidado.avarias > 0 && (
            <>
              <div className="financeiro-filtros">
                <div>
                  <div className="financeiro-stat-label">SE NADA FOSSE LANÇADO</div>
                  <div className="financeiro-stat-valor">
                    {formatCurrency(consolidado.valorAvariado)}
                  </div>
                </div>
                <div>
                  <div className="financeiro-stat-label">MERCADO LIVRE COBRIU</div>
                  <div className="financeiro-stat-valor">
                    {formatCurrency(consolidado.recebidoValor)}
                  </div>
                </div>
                <div>
                  <div className="financeiro-stat-label">FÁBRICA CREDITOU</div>
                  <div className="financeiro-stat-valor">
                    {formatCurrency(consolidado.creditoDado)}
                  </div>
                </div>
                <div>
                  <div className="financeiro-stat-label">AINDA DESCOBERTO</div>
                  <div className="financeiro-stat-valor">
                    {formatCurrency(consolidado.descoberto)}
                  </div>
                </div>
              </div>
              <p className="financeiro-td-mudo">
                {consolidado.avarias} avaria{consolidado.avarias === 1 ? "" : "s"} no período ·{" "}
                {consolidado.naoPedido} sem pedir ao ML · {consolidado.pedido} aguardando resposta ·{" "}
                {consolidado.recebido} recebido{consolidado.recebido === 1 ? "" : "s"} ·{" "}
                {consolidado.negado} negado{consolidado.negado === 1 ? "" : "s"}.
                {consolidado.naoPedido > 0 &&
                  ` Enquanto ${consolidado.naoPedido} não for pedido, esse dinheiro aparece como perda total sem ser.`}
              </p>
            </>
          )}

          <div className="financeiro-filtros">
            <BuscaSelecao
              itens={itensCliente}
              valor={devCliente ? Number(devCliente) : null}
              placeholder="Loja que devolveu"
              onEscolher={(id) => setDevCliente(id ? String(id) : "")}
            />
            <BuscaSelecao
              itens={itensProduto}
              valor={devProduto ? Number(devProduto) : null}
              placeholder="Produto por nome ou SKU"
              onEscolher={(id) => setDevProduto(id ? String(id) : "")}
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder="Qtd"
              value={devQtd}
              onChange={(e) => setDevQtd(e.target.value)}
            />
            <select
              className="clonar-input fabricacao-input-pequeno"
              value={devCondicao}
              onChange={(e) => setDevCondicao(e.target.value as CondicaoDevolucao)}
            >
              <option value="BOM">Inteiro — volta pro estoque</option>
              <option value="ESTOURADO">Estourado — descarte</option>
              <option value="QUEBRADO">Quebrado — tinta pro tambor</option>
            </select>
          </div>

          <div className="financeiro-filtros">
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder={`Crédito (${formatCurrency(creditoSugerido)})`}
              value={devCredito}
              onChange={(e) => setDevCredito(e.target.value)}
              title="Vazio usa o sugerido: valor cheio se voltou inteiro, zero se avariado"
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder="Nº da nota"
              value={devNota}
              onChange={(e) => setDevNota(e.target.value)}
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder="Quem recebeu"
              value={devRecebidoPor}
              onChange={(e) => setDevRecebidoPor(e.target.value)}
            />
            <input
              className="clonar-input"
              placeholder="Observação (opcional)"
              value={devObs}
              onChange={(e) => setDevObs(e.target.value)}
            />
            <button type="button" className="btn-responder" onClick={() => void lancarDevolucao()}>
              <IconPlus size={14} /> Registrar devolução
            </button>
          </div>

          <div className="financeiro-tabela-wrap">
            <table className="financeiro-tabela">
              <thead>
                <tr>
                  <th>DATA</th>
                  <th>LOJA</th>
                  <th>PRODUTO</th>
                  <th className="financeiro-th-numero">QTD</th>
                  <th>CONDIÇÃO</th>
                  <th>RESSARCIMENTO ML</th>
                  <th className="financeiro-th-numero">CRÉDITO</th>
                  <th>NOTA FISCAL</th>
                  <th>RECEBEU</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {!devolucoes.length && (
                  <tr>
                    <td colSpan={10}>Nenhuma devolução registrada.</td>
                  </tr>
                )}
                {devolucoes.map((d) => (
                  <tr key={d.id}>
                    <td className="financeiro-td-mudo">{data(d.data)}</td>
                    <td>{d.clienteNome}</td>
                    <td>{d.produtoNome}</td>
                    <td className="financeiro-th-numero">{d.quantidade}</td>
                    <td className="financeiro-td-mudo">
                      {d.condicao === "BOM"
                        ? "inteiro · voltou ao estoque"
                        : d.condicao === "ESTOURADO"
                          ? "estourado · descartado"
                          : "quebrado · tambor"}
                    </td>
                    <td>
                      {d.condicao === "BOM" ? (
                        <span className="financeiro-td-mudo">não se aplica</span>
                      ) : (
                        <>
                          <select
                            className="clonar-input fabricacao-input-pequeno"
                            value={d.ressarcimentoStatus}
                            onChange={(e) =>
                              void mudarRessarcimento(d, e.target.value as StatusRessarcimento)
                            }
                          >
                            <option value="NAO_PEDIDO">Não pedido</option>
                            <option value="PEDIDO">Pedido — aguardando</option>
                            <option value="RECEBIDO">Recebido</option>
                            <option value="NEGADO">Negado</option>
                          </select>
                          {d.ressarcimentoStatus === "RECEBIDO" && (
                            <input
                              className="clonar-input fabricacao-input-pequeno"
                              defaultValue={d.ressarcimentoValor || ""}
                              placeholder={String(d.valorDaMercadoria)}
                              title="Quanto o Mercado Livre pagou de fato"
                              onBlur={(ev) => {
                                if (num(ev.target.value) !== d.ressarcimentoValor)
                                  void mudarValorRessarcimento(d, ev.target.value);
                              }}
                            />
                          )}
                          {d.descoberto > 0 && (
                            <span className="financeiro-td-mudo">
                              {" "}
                              descoberto {formatCurrency(d.descoberto)}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="financeiro-th-numero">
                      <input
                        className="clonar-input fabricacao-input-pequeno"
                        defaultValue={d.credito || ""}
                        placeholder="—"
                        title="Editável: cubra aqui o que o Mercado Livre não pagou"
                        onBlur={(ev) => {
                          if (num(ev.target.value) !== d.credito) void mudarCredito(d, ev.target.value);
                        }}
                      />
                    </td>
                    <td className={d.notaCancelada ? "financeiro-td-mudo" : undefined}>
                      <button
                        type="button"
                        className={d.notaCancelada ? "btn-excluir" : "btn-responder"}
                        onClick={() => void alternarNota(d)}
                        title={
                          d.notaCancelada
                            ? "Marcada como cancelada — clique pra desfazer"
                            : "Cancele a nota no emissor e marque aqui"
                        }
                      >
                        {d.notaCancelada
                          ? `NF ${d.notaFiscal ?? ""} cancelada`
                          : `CANCELAR NF ${d.notaFiscal ?? ""}`}
                      </button>
                    </td>
                    <td className="financeiro-td-mudo">{d.recebidoPor ?? "—"}</td>
                    <td>
                      <BotaoExcluir onConfirmar={() => void apagarDevolucao(d)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="financeiro-td-mudo">
            O ressarcimento do Mercado Livre cai na conta da <strong>loja</strong>, não da fábrica
            — lançar aqui não move dinheiro nenhum, serve pra avaria parada não parecer perda de
            100% quando o ML já cobriu. O que o ML não pagar aparece como{" "}
            <strong>descoberto</strong>, e é esse número que você usa pra decidir o crédito.
          </p>
          <p className="financeiro-td-mudo">
            A fábrica emite nota em 100% das vendas, então toda devolução deixa uma nota pra
            cancelar. O botão vermelho não cancela nada sozinho — quem cancela é o emissor. Ele
            marca aqui que foi feito, pra pendência sair da lista. Esquecer de cancelar significa
            pagar imposto sobre uma venda que foi desfeita.
          </p>
        </>
      )}
    </div>
  );
}
