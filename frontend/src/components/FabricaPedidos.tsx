import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  conferirPlanilha,
  importarPlanilha,
  fetchCreditos,
  lancarAntecipacao,
  lancarCredito,
  definirPercentualBonificacao,
  excluirCredito,
  excluirProvisorios,
  fetchExtrato,
  fetchPagamentos,
  fetchOrigensPix,
  salvarOrigemPix,
  excluirOrigemPix,
  conferirPix,
  conferirPlanilhaArquivo,
  fetchEntradas,
  conferirNota,
  lancarEntrada,
  excluirEntrada,
  statusBling,
  autorizarBling,
  desconectarBling,
  sincronizarBling,
  progressoBling,
  criarApelidoCliente,
  importarPix,
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
import { fetchFabricaProdutos, criarFabricaProduto } from "../api/fabricaProdutos";
import type {
  Pedido,
  PedidoEntrada,
  StatusPedido,
  EstoqueProduto,
  AjusteProduto,
  ContaCorrente,
  IdadeSaldo,
  ConferenciaPlanilha,
  SkuFaltando,
  Credito,
  SaldoCredito,
  AlertaProvisorio,
  Pagamento,
  LinhaExtrato,
  Devolucao,
  CondicaoDevolucao,
  StatusRessarcimento,
  ConsolidadoRessarcimento,
  OrigemPix,
  ConferenciaPix,
  DestinoPix,
  Entrada,
  ConferenciaNota,
  StatusBling,
  ProgressoBling,
  ClienteFaltando,
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
    | "pedidos"
    | "novo"
    | "importar"
    | "estoque"
    | "fechamento"
    | "creditos"
    | "devolucoes"
    | "pix"
    | "entrada"
  >("pedidos");

  // importacao de planilha: cola o relatorio, confere, depois lanca
  const [impTexto, setImpTexto] = useState("");
  const [impOrigem, setImpOrigem] = useState("SHOPEE");
  const [conferencia, setConferencia] = useState<ConferenciaPlanilha | null>(null);
  const [importando, setImportando] = useState(false);

  // conciliacao do PIX: o relatorio de recebimento do Sicoob, um PIX por linha.
  // O extrato de conta corrente nao serve — ele agrupa e some com o pagador.
  const [pixArquivo, setPixArquivo] = useState<File | null>(null);
  const [confPix, setConfPix] = useState<ConferenciaPix | null>(null);
  const [origensPix, setOrigensPix] = useState<OrigemPix[]>([]);
  const [pixOcupado, setPixOcupado] = useState(false);
  // o que o Hudson escolheu pra cada pendente antes de gravar: "12" e uma loja,
  // "APORTE" / "AVULSA" / "IGNORAR" sao destinos que nao abatem divida
  const [pixEscolha, setPixEscolha] = useState<Record<string, string>>({});
  const pixInputRef = useRef<HTMLInputElement | null>(null);
  const impInputRef = useRef<HTMLInputElement | null>(null);

  // entrada de mercadoria: a nota do fornecedor que alimenta o estoque
  const [entradas, setEntradas] = useState<Entrada[]>([]);
  const [notaArquivo, setNotaArquivo] = useState<File | null>(null);
  const [confNota, setConfNota] = useState<ConferenciaNota | null>(null);
  const [notaFornecedor, setNotaFornecedor] = useState("");
  const [notaDocumento, setNotaDocumento] = useState("");
  const [notaData, setNotaData] = useState("");
  const [notaOcupada, setNotaOcupada] = useState(false);
  const notaInputRef = useRef<HTMLInputElement | null>(null);

  // Bling: o site puxa as vendas em vez de esperar o arquivo exportado
  const [bling, setBling] = useState<StatusBling | null>(null);
  const [blingDe, setBlingDe] = useState("");
  const [blingAte, setBlingAte] = useState("");
  const [blingOcupado, setBlingOcupado] = useState(false);
  const [blingProgresso, setBlingProgresso] = useState<ProgressoBling | null>(null);

  // nome que veio do ERP -> cliente escolhido pra ligar nele
  const [apelidoEscolha, setApelidoEscolha] = useState<Record<string, number>>({});

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
  async function conferir() {
    if (!impTexto.trim()) return setErro("Cole as linhas da planilha.");
    try {
      const c = await conferirPlanilha(impTexto, impOrigem);
      setConferencia(c);
      setErro(null);
      setAviso(
        `${c.linhas.length} linha${c.linhas.length === 1 ? "" : "s"} lida${
          c.linhas.length === 1 ? "" : "s"
        } de ${c.linhasNoArquivo}. ${c.prontas} pronta${c.prontas === 1 ? "" : "s"}, ${
          c.comProblema
        } com problema, ${c.jaImportadas} já importada${c.jaImportadas === 1 ? "" : "s"}.`
      );
    } catch (e) {
      setConferencia(null);
      setErro(e instanceof Error ? e.message : "Falha ao ler a planilha.");
    }
  }

  async function importar() {
    if (!conferencia || conferencia.prontas === 0)
      return setErro("Nada pronto pra importar. Confira a planilha primeiro.");
    if (
      !window.confirm(
        `Lançar ${conferencia.prontas} linha${
          conferencia.prontas === 1 ? "" : "s"
        } como pedido? As com problema ficam de fora e podem ser subidas depois.`
      )
    )
      return;
    setImportando(true);
    try {
      const r = await importarPlanilha(impTexto, impOrigem);
      setErro(null);
      setAviso(
        `${r.pedidosCriados} pedido${r.pedidosCriados === 1 ? "" : "s"} criado${
          r.pedidosCriados === 1 ? "" : "s"
        } com ${r.itensLancados} item${r.itensLancados === 1 ? "" : "ns"}, ${formatCurrency(
          r.valorLancado
        )}. ${r.puladas} linha${r.puladas === 1 ? "" : "s"} de fora.`
      );
      setConferencia(null);
      setImpTexto("");
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao importar.");
    } finally {
      setImportando(false);
    }
  }

  // Cadastra o SKU que faltou sem sair da tela: o preco vem do que a loja pagou
  // de verdade na planilha, que e melhor chute do que deixar em branco.
  async function cadastrarSkuFaltando(s: SkuFaltando) {
    const nome = window.prompt(
      `Nome do produto pro SKU ${s.sku}? Apareceu ${s.linhas}x, ${s.quantidade} un, ` +
        `${formatCurrency(s.precoUnitario)} cada.`,
      s.sku
    );
    if (nome === null || !nome.trim()) return;
    try {
      await criarFabricaProduto({
        sku: s.sku,
        nome: nome.trim(),
        origem: "DISTRIBUIDORA",
        ean: null,
        familia: null,
        custoCompra: null,
        formulaId: null,
        embalagemId: null,
        precoVenda: s.precoUnitario,
        ativo: true,
      });
      setErro(null);
      setAviso(`${s.sku} cadastrado. Confira a planilha de novo pra ele entrar.`);
      await carregar();
      const c = await conferirPlanilha(impTexto, impOrigem);
      setConferencia(c);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao cadastrar o produto.");
    }
  }

  async function ligarApelido(c: ClienteFaltando) {
    const clienteId = apelidoEscolha[c.nome];
    if (!clienteId) {
      setErro(`Escolha de qual cliente é "${c.nome}".`);
      return;
    }
    try {
      const a = await criarApelidoCliente(clienteId, c.nome);
      setErro(null);
      setAviso(`"${c.nome}" agora é ${a.clienteNome}. Vale pras próximas importações também.`);
      // reconfere na hora: sem isso o operador teria que subir o arquivo de
      // novo pra ver as linhas saindo do vermelho
      setConferencia(await conferirPlanilha(impTexto, impOrigem));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gravar o apelido.");
    }
  }

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

  // Agrupa a conta corrente por quem fecha a conta. Várias lojas vendem no
  // próprio nome e a cobrança vai inteira pra outra — quem manda o PIX na terça
  // precisa ver um número só, não cinco linhas soltas pra somar na mão.
  const gruposFechamento = useMemo(() => {
    const g = new Map<
      number,
      { paganteId: number; pagante: string; total: number; linhas: ContaCorrente[] }
    >();
    for (const c of contaCorrente) {
      const atual = g.get(c.paganteId) ?? {
        paganteId: c.paganteId,
        pagante: c.paganteNome,
        total: 0,
        linhas: [],
      };
      atual.total += c.saldo;
      atual.linhas.push(c);
      g.set(c.paganteId, atual);
    }
    for (const x of g.values()) {
      // o pagante primeiro, depois as lojas dele por quanto devem
      x.linhas.sort((a, b) =>
        a.clienteId === x.paganteId ? -1 : b.clienteId === x.paganteId ? 1 : b.saldo - a.saldo
      );
    }
    // quem deve mais aparece primeiro: é a ordem em que se cobra
    return [...g.values()].sort((a, b) => b.total - a.total);
  }, [contaCorrente]);

  const carregarBling = useCallback(async () => {
    try {
      setBling(await statusBling());
    } catch {
      // integração não configurada não é erro de tela: o bloco some sozinho
      setBling(null);
    }
  }, []);

  useEffect(() => {
    if (aba === "importar") void carregarBling();
  }, [aba, carregarBling]);

  // primeiro e último dia do mês corrente, que é o período que se puxa
  useEffect(() => {
    if (blingDe || blingAte) return;
    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const [a, m] = hoje.split("-");
    const ultimo = new Date(Number(a), Number(m), 0).getDate();
    setBlingDe(`${a}-${m}-01`);
    setBlingAte(`${a}-${m}-${String(ultimo).padStart(2, "0")}`);
  }, [blingDe, blingAte]);

  async function conectarBling() {
    setBlingOcupado(true);
    setErro(null);
    try {
      const url = await autorizarBling();
      // janela separada: o Bling pede login e não abre dentro de iframe
      window.open(url, "bling", "width=980,height=760");
      setAviso("Autorize na janela do Bling e depois clique em Atualizar status.");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao conectar o Bling.");
    } finally {
      setBlingOcupado(false);
    }
  }

  // Recolhe o que a sincronização já produziu. Fica separado do laço que
  // pergunta porque a mesma coisa acontece quando a tela abre no meio de uma
  // puxada que começou antes — fechar a aba não cancela nada no servidor.
  const acolherBling = useCallback((p: ProgressoBling) => {
    setBlingProgresso(p);
    if (p.estado === "erro") {
      setErro(p.erro ?? "Falha ao sincronizar com o Bling.");
      setBlingOcupado(false);
      return;
    }
    if (p.estado !== "pronto" || !p.resultado) return;
    const r = p.resultado;
    // o texto entra no mesmo campo do arquivo: o botão de lançar é o mesmo
    setImpTexto(r.texto);
    setImpOrigem("BLING");
    setConferencia(r);
    setAviso(
      `${r.pedidos} pedido(s) lidos do Bling, ${r.itensLidos} itens.` +
        (r.falhas.length ? ` ${r.falhas.length} pedido(s) não abriram.` : "")
    );
    setBlingOcupado(false);
  }, []);

  // Enquanto estiver rodando, pergunta de cinco em cinco segundos. Um mês passa
  // de dez minutos e a resposta não cabe numa requisição só.
  useEffect(() => {
    const rodando =
      blingProgresso?.estado === "listando" || blingProgresso?.estado === "puxando";
    if (!rodando) return;
    const t = window.setInterval(() => {
      void progressoBling().then(acolherBling).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(t);
  }, [blingProgresso?.estado, acolherBling]);

  // Ao abrir a aba, pega uma puxada que já esteja em andamento.
  useEffect(() => {
    if (aba !== "importar" || blingProgresso) return;
    void progressoBling()
      .then((p) => {
        if (p.estado === "nenhuma") return;
        if (p.estado === "listando" || p.estado === "puxando") setBlingOcupado(true);
        acolherBling(p);
      })
      .catch(() => undefined);
  }, [aba, blingProgresso, acolherBling]);

  async function puxarDoBling() {
    setBlingOcupado(true);
    setErro(null);
    setConferencia(null);
    try {
      setBlingProgresso(await sincronizarBling(blingDe, blingAte));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao sincronizar com o Bling.");
      setBlingOcupado(false);
    }
  }

  const carregarEntradas = useCallback(async () => {
    try {
      setEntradas(await fetchEntradas());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao carregar as entradas.");
    }
  }, []);

  useEffect(() => {
    if (aba === "entrada") void carregarEntradas();
  }, [aba, carregarEntradas]);

  async function conferirArquivoNota(arquivo: File) {
    setNotaOcupada(true);
    setErro(null);
    try {
      setConfNota(await conferirNota(arquivo));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao ler a nota.");
      setConfNota(null);
    } finally {
      setNotaOcupada(false);
    }
  }

  async function lancarNota() {
    if (!confNota || !confNota.prontas.length) return;
    if (
      !window.confirm(
        `Lançar ${confNota.prontas.length} item(ns), ${confNota.quantidade} unidades, ` +
          `${formatCurrency(confNota.total)}? Isso entra no estoque.`
      )
    ) {
      return;
    }
    setNotaOcupada(true);
    setErro(null);
    try {
      const r = await lancarEntrada({
        fornecedorNome: notaFornecedor.trim() || null,
        documento: notaDocumento.trim() || null,
        data: notaData || null,
        observacao: null,
        itens: confNota.prontas.map((l) => ({
          produtoId: l.produtoId as number,
          quantidade: l.quantidade,
          custoUnitario: l.custoUnitario,
        })),
      });
      setAviso(
        `Entrada ${r.id} lançada: ${r.itens} itens, ${formatCurrency(r.total)}. ` +
          `O estoque já subiu.`
      );
      setConfNota(null);
      setNotaArquivo(null);
      setNotaDocumento("");
      await carregarEntradas();
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao lançar a entrada.");
    } finally {
      setNotaOcupada(false);
    }
  }

  const carregarOrigensPix = useCallback(async () => {
    try {
      setOrigensPix(await fetchOrigensPix());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao carregar as origens do PIX.");
    }
  }, []);

  useEffect(() => {
    if (aba === "pix") void carregarOrigensPix();
  }, [aba, carregarOrigensPix]);

  async function conferirArquivoPix(arquivo: File) {
    setPixOcupado(true);
    setErro(null);
    try {
      const c = await conferirPix(arquivo);
      setConfPix(c);
      setPixEscolha({});
      if (c.pendentes.length === 0 && c.novos.length === 0 && c.jaImportados.transacoes > 0) {
        setAviso("Este relatório já tinha sido importado inteiro. Nada novo pra lançar.");
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao conferir o relatório PIX.");
      setConfPix(null);
    } finally {
      setPixOcupado(false);
    }
  }

  // grava a origem de um pagador que apareceu sem dono e confere de novo: o
  // pendente some da lista e o valor dele entra no bloco da loja
  async function apontarPendente(pagador: string) {
    const escolha = pixEscolha[pagador];
    if (!escolha) return;
    const destino: DestinoPix = ["APORTE", "AVULSA", "IGNORAR"].includes(escolha)
      ? (escolha as DestinoPix)
      : "CLIENTE";
    setPixOcupado(true);
    setErro(null);
    try {
      setOrigensPix(
        await salvarOrigemPix(pagador, destino === "CLIENTE" ? Number(escolha) : null, destino)
      );
      if (pixArquivo) await conferirArquivoPix(pixArquivo);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar a origem.");
    } finally {
      setPixOcupado(false);
    }
  }

  async function lancarPix() {
    if (!pixArquivo || !confPix) return;
    const quantos = confPix.novos.reduce((t, n) => t + n.transacoes, 0);
    const valor = confPix.novos.reduce((t, n) => t + n.valor, 0);
    if (
      !window.confirm(
        `Lançar ${quantos} PIX, ${formatCurrency(valor)}, abatendo a dívida de ` +
          `${confPix.novos.length} loja(s)? Isso muda o saldo de todas elas.`
      )
    ) {
      return;
    }
    setPixOcupado(true);
    setErro(null);
    try {
      const r = await importarPix(pixArquivo);
      setAviso(
        `${r.pagamentosCriados} pagamento(s) lançado(s), ${formatCurrency(r.valorLancado)}.` +
          (r.pagamentosAdotados
            ? ` ${r.pagamentosAdotados} já estavam lançados na mão e foram amarrados ao PIX em vez de duplicar.`
            : "") +
          (r.pendentes ? ` ${r.pendentes} continuam sem origem apontada.` : "")
      );
      await carregar();
      await conferirArquivoPix(pixArquivo);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao importar o PIX.");
    } finally {
      setPixOcupado(false);
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
        {(
          [
            "pedidos",
            "novo",
            "importar",
            "estoque",
            "fechamento",
            "creditos",
            "devolucoes",
            "pix",
            "entrada",
          ] as const
        ).map((a) => (
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
                : a === "importar"
                  ? `Importar planilha${
                      conferencia?.skusFaltando.length
                        ? ` (${conferencia.skusFaltando.length} SKU)`
                        : ""
                    }`
                  : a === "estoque"
                    ? `Estoque de produto${alertas.length ? ` (${alertas.length})` : ""}`
                    : a === "fechamento"
                      ? "Fechamento"
                      : a === "creditos"
                        ? `Créditos${saldosCredito.length ? ` (${saldosCredito.length})` : ""}`
                        : a === "devolucoes"
                          ? `Devoluções${notasPendentes ? ` (${notasPendentes} NF)` : ""}`
                          : a === "pix"
                            ? `Conciliar PIX${
                                confPix?.pendentes.length ? ` (${confPix.pendentes.length})` : ""
                              }`
                            : "Entrada de mercadoria"}
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

      {aba === "importar" && (
        <>
          <div className="financeiro-topo">
            <div>
              <h2>Importar planilha de venda</h2>
              <p className="financeiro-td-mudo">
                Cole o relatório direto do Excel — pode ser Shopee, venda direta, ou o que o
                ERP exporta. Ele descobre as colunas pelo cabeçalho, então não precisa
                reorganizar nada. Precisa ter <strong>SKU</strong>, porque é o SKU que diz qual
                produto saiu do estoque; relatório só com número do pedido e total não serve
                aqui. Nada é lançado antes de você conferir.
              </p>
            </div>
          </div>

          {bling && (
            <div className="credito-alerta">
              {!bling.configurado ? (
                <p>
                  <strong>Bling não configurado no servidor.</strong> Falta gerar o aplicativo
                  em Configurações, Cadastro de aplicativos, e pôr as credenciais no .env do
                  backend. Enquanto isso, a importação por arquivo funciona normal.
                </p>
              ) : !bling.conectado ? (
                <>
                  <p>
                    <strong>Puxe as vendas direto do Bling</strong> em vez de exportar o
                    relatório e subir o arquivo. Autorize uma vez e o site busca sozinho.
                  </p>
                  <button
                    type="button"
                    className="btn-responder"
                    disabled={blingOcupado}
                    onClick={() => void conectarBling()}
                  >
                    Conectar o Bling
                  </button>{" "}
                  <button
                    type="button"
                    className="btn-excluir"
                    onClick={() => void carregarBling()}
                  >
                    Atualizar status
                  </button>
                </>
              ) : (
                <>
                  <p>
                    <strong>Bling conectado.</strong> Escolha o período e puxe as vendas — vem
                    item a item, com SKU, e cai na mesma conferência do arquivo. O Bling só
                    entrega três pedidos por segundo, então um mês leva uns dez minutos; pode
                    sair da tela, a busca continua no servidor.
                    {bling.diasParaVencer !== null && bling.diasParaVencer < 7 && (
                      <>
                        {" "}
                        A autorização vence em {bling.diasParaVencer} dia(s); sincronizar
                        renova sozinho.
                      </>
                    )}
                  </p>
                  <input
                    type="date"
                    className="clonar-input fabricacao-input-pequeno"
                    value={blingDe}
                    onChange={(e) => setBlingDe(e.target.value)}
                  />{" "}
                  <input
                    type="date"
                    className="clonar-input fabricacao-input-pequeno"
                    value={blingAte}
                    onChange={(e) => setBlingAte(e.target.value)}
                  />{" "}
                  <button
                    type="button"
                    className="btn-responder"
                    disabled={blingOcupado || !blingDe || !blingAte}
                    onClick={() => void puxarDoBling()}
                  >
                    {!blingOcupado
                      ? "Puxar vendas do Bling"
                      : blingProgresso?.estado === "puxando" && blingProgresso.total
                        ? `Puxando ${blingProgresso.feitos} de ${blingProgresso.total} pedidos...`
                        : "Listando os pedidos..."}
                  </button>{" "}
                  <button
                    type="button"
                    className="btn-excluir"
                    disabled={blingOcupado}
                    onClick={async () => {
                      if (!window.confirm("Desconectar o Bling? Vai precisar autorizar de novo."))
                        return;
                      await desconectarBling();
                      await carregarBling();
                    }}
                  >
                    Desconectar
                  </button>
                </>
              )}
            </div>
          )}

          <div className="financeiro-filtros">
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder="Origem (SHOPEE, ERP...)"
              value={impOrigem}
              onChange={(e) => setImpOrigem(e.target.value.toUpperCase())}
            />
            <input
              ref={impInputRef}
              type="file"
              accept=".xlsx,.csv,.tsv,.txt"
              style={{ display: "none" }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setImportando(true);
                setErro(null);
                try {
                  const c = await conferirPlanilhaArquivo(f, impOrigem);
                  // guarda o texto convertido: quem lanca e a rota de texto,
                  // entao arquivo e cola seguem o mesmo caminho
                  setImpTexto(c.texto);
                  setConferencia(c);
                } catch (err) {
                  setErro(err instanceof Error ? err.message : "Falha ao ler o arquivo.");
                } finally {
                  setImportando(false);
                }
              }}
            />
            <button
              type="button"
              className="btn-excluir"
              disabled={importando}
              onClick={() => impInputRef.current?.click()}
              title="Sobe a planilha como arquivo .xlsx ou .csv — mais de mil linhas travam ao colar"
            >
              Escolher arquivo
            </button>
            <button type="button" className="btn-excluir" onClick={() => void conferir()}>
              Conferir
            </button>
            <button
              type="button"
              className="btn-responder"
              onClick={() => void importar()}
              disabled={!conferencia || conferencia.prontas === 0 || importando}
            >
              {importando
                ? "Lançando..."
                : `Lançar ${conferencia?.prontas ?? 0} como pedido`}
            </button>
          </div>

          <textarea
            className="clonar-input"
            rows={8}
            placeholder="Cole aqui as linhas da planilha, com o cabeçalho na primeira linha."
            value={impTexto}
            onChange={(e) => setImpTexto(e.target.value)}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
          />

          {conferencia && (
            <>
              <div className="contas-cartoes">
                <div className="contas-cartao">
                  <span className="financeiro-stat-label">PRONTAS</span>
                  <strong>{conferencia.prontas}</strong>
                </div>
                <div
                  className={
                    conferencia.comProblema
                      ? "contas-cartao contas-cartao-alerta"
                      : "contas-cartao"
                  }
                >
                  <span className="financeiro-stat-label">COM PROBLEMA</span>
                  <strong>{conferencia.comProblema}</strong>
                </div>
                <div className="contas-cartao">
                  <span className="financeiro-stat-label">JÁ IMPORTADAS</span>
                  <strong>{conferencia.jaImportadas}</strong>
                </div>
                <div className="contas-cartao">
                  <span className="financeiro-stat-label">VALOR</span>
                  <strong>{formatCurrency(conferencia.totalValor)}</strong>
                </div>
                <div className="contas-cartao">
                  <span className="financeiro-stat-label">LINHAS NO ARQUIVO</span>
                  <strong>
                    {conferencia.linhasNoArquivo}
                    {conferencia.linhasVazias > 0 && (
                      <span className="financeiro-td-mudo">
                        {" "}
                        · {conferencia.linhasVazias} em branco
                      </span>
                    )}
                  </strong>
                </div>
              </div>

              <p className="financeiro-td-mudo">
                Colunas que reconheci:{" "}
                {Object.entries(conferencia.colunas)
                  .map(([campo, titulo]) => `${campo} = "${titulo}"`)
                  .join(" · ")}
              </p>

              {conferencia.clientesFaltando.length > 0 && (
                <div className="credito-alerta">
                  <p>
                    <strong>
                      {conferencia.clientesFaltando.length} nome
                      {conferencia.clientesFaltando.length === 1 ? "" : "s"} do ERP sem cliente
                    </strong>{" "}
                    — o Bling escreve razão social e aqui o cadastro é o nome de porta. Diga uma
                    vez de quem é cada um e o sistema passa a reconhecer sozinho daqui pra
                    frente.
                  </p>
                  <table className="financeiro-tabela">
                    <thead>
                      <tr>
                        <th>NOME NO ERP</th>
                        <th>PEDIDOS</th>
                        <th className="financeiro-th-numero">LINHAS</th>
                        <th className="financeiro-th-numero">VALOR</th>
                        <th>É QUAL CLIENTE?</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {conferencia.clientesFaltando.map((cf) => (
                        <tr key={cf.nome}>
                          <td>
                            <strong>{cf.nome}</strong>
                            {cf.ambiguo && (
                              <>
                                {" "}
                                <span className="financeiro-td-mudo">
                                  (casou com mais de um cliente)
                                </span>
                              </>
                            )}
                          </td>
                          <td className="financeiro-td-mudo">{cf.documentos.join(", ")}</td>
                          <td className="financeiro-th-numero financeiro-td-mudo">{cf.linhas}</td>
                          <td className="financeiro-th-numero">{formatCurrency(cf.valor)}</td>
                          <td>
                            <select
                              className="clonar-input"
                              value={apelidoEscolha[cf.nome] ?? ""}
                              onChange={(e) =>
                                setApelidoEscolha((a) => ({
                                  ...a,
                                  [cf.nome]: Number(e.target.value),
                                }))
                              }
                            >
                              <option value="">Escolha o cliente</option>
                              {clientes.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.nome}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn-responder"
                              disabled={!apelidoEscolha[cf.nome]}
                              onClick={() => void ligarApelido(cf)}
                            >
                              Ligar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {conferencia.skusFaltando.length > 0 && (
                <div className="credito-alerta">
                  <p>
                    <strong>
                      {conferencia.skusFaltando.length} SKU
                      {conferencia.skusFaltando.length === 1 ? "" : "s"} sem cadastro
                    </strong>{" "}
                    — estas linhas não viram pedido enquanto o produto não existir. Cadastre
                    aqui mesmo: o preço sugerido é o que a loja pagou de verdade na planilha.
                  </p>
                  <table className="financeiro-tabela">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>QUEM COMPROU</th>
                        <th className="financeiro-th-numero">LINHAS</th>
                        <th className="financeiro-th-numero">QTD</th>
                        <th className="financeiro-th-numero">PREÇO UN.</th>
                        <th className="financeiro-th-numero">VALOR</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {conferencia.skusFaltando.map((sf) => (
                        <tr key={sf.sku}>
                          <td>
                            <strong>{sf.sku}</strong>
                          </td>
                          <td className="financeiro-td-mudo">{sf.clientes.join(", ")}</td>
                          <td className="financeiro-th-numero financeiro-td-mudo">{sf.linhas}</td>
                          <td className="financeiro-th-numero financeiro-td-mudo">
                            {sf.quantidade}
                          </td>
                          <td className="financeiro-th-numero financeiro-td-mudo">
                            {formatCurrency(sf.precoUnitario)}
                          </td>
                          <td className="financeiro-th-numero">{formatCurrency(sf.valor)}</td>
                          <td>
                            <button
                              type="button"
                              className="btn-responder"
                              onClick={() => void cadastrarSkuFaltando(sf)}
                            >
                              Cadastrar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="financeiro-tabela-wrap">
                <table className="financeiro-tabela">
                  <thead>
                    <tr>
                      <th className="financeiro-th-numero">LINHA</th>
                      <th>DATA</th>
                      <th>CLIENTE</th>
                      <th>SKU</th>
                      <th>PRODUTO</th>
                      <th className="financeiro-th-numero">QTD</th>
                      <th className="financeiro-th-numero">VALOR</th>
                      <th>SITUAÇÃO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conferencia.linhas.slice(0, 300).map((l) => (
                      <tr key={l.linha}>
                        <td className="financeiro-th-numero financeiro-td-mudo">{l.linha}</td>
                        <td className="financeiro-td-mudo">{l.data ? data(l.data) : "—"}</td>
                        <td className={l.clienteId ? undefined : "financeiro-td-mudo"}>
                          {l.cliente || "—"}
                        </td>
                        <td>{l.sku || "—"}</td>
                        <td className="financeiro-td-mudo">{l.produtoNome ?? "—"}</td>
                        <td className="financeiro-th-numero financeiro-td-mudo">
                          {l.quantidade}
                        </td>
                        <td className="financeiro-th-numero">{formatCurrency(l.total)}</td>
                        <td className={l.problema ? undefined : "financeiro-td-mudo"}>
                          {l.jaImportada ? "já importada" : (l.problema ?? "pronta")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {conferencia.linhas.length > 300 && (
                <p className="financeiro-td-mudo">
                  Mostrando as 300 primeiras de {conferencia.linhas.length}. A importação
                  pega todas.
                </p>
              )}
            </>
          )}
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
                {gruposFechamento.flatMap((g) =>
                  g.linhas.map((c, i) => (
                    <tr key={c.clienteId}>
                      <td>
                        <button
                          type="button"
                          className="fabricacao-envase-nome-editavel"
                          onClick={() => void abrirExtrato(c)}
                        >
                          {c.clienteId === g.paganteId ? c.clienteNome : `↳ ${c.clienteNome}`}
                        </button>
                        {i === 0 && g.linhas.length > 1 && (
                          <div className="financeiro-td-mudo">
                            fecha por {g.linhas.length - 1} loja
                            {g.linhas.length === 2 ? "" : "s"} ·{" "}
                            <strong>{formatCurrency(Math.max(0, g.total))}</strong> no total
                          </div>
                        )}
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
                  ))
                )}
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

      {aba === "pix" && (
        <>
          <div className="financeiro-topo">
            <div>
              <h2>Conciliar PIX recebido</h2>
              <p className="financeiro-td-mudo">
                Suba o <strong>relatório de Recebimento Pix</strong> do Sicoob — no app, em{" "}
                <em>Pix, Extrato Pix, Recebidos</em>, formato .xlsx. Não é o extrato de conta
                corrente: o extrato empacota os PIX de outros bancos numa linha por dia e perde
                o pagador. Em julho e agosto de 2026 foram 41 linhas escondendo 152 PIX, 83% do
                dinheiro entrando sem nome.
              </p>
              <p className="financeiro-td-mudo">
                O relatório não traz CNPJ, então a ligação é pelo nome do pagador. Você aponta
                uma vez quem é cada um e fica gravado — no mês seguinte entra sozinho. Nada é
                lançado antes de você conferir.
              </p>
            </div>
          </div>

          <div className="financeiro-filtros">
            <input
              ref={pixInputRef}
              type="file"
              accept=".xlsx"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setPixArquivo(f);
                if (f) void conferirArquivoPix(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="btn-excluir"
              disabled={pixOcupado}
              onClick={() => pixInputRef.current?.click()}
            >
              {pixArquivo ? `Trocar arquivo (${pixArquivo.name})` : "Escolher relatório .xlsx"}
            </button>
            <button
              type="button"
              className="btn-responder"
              disabled={!confPix || confPix.novos.length === 0 || pixOcupado}
              onClick={() => void lancarPix()}
            >
              {pixOcupado
                ? "Processando..."
                : `Lançar ${confPix?.novos.reduce((t, n) => t + n.transacoes, 0) ?? 0} PIX`}
            </button>
          </div>

          {confPix && (
            <>
              <div className="contas-cartoes">
                <div className="contas-cartao">
                  <span className="financeiro-stat-label">NO ARQUIVO</span>
                  <strong>{confPix.linhasNoArquivo}</strong>
                  <span className="financeiro-td-mudo">
                    {confPix.periodo
                      ? `${confPix.periodo.de} a ${confPix.periodo.ate}`
                      : "sem período"}
                  </span>
                </div>
                <div className="contas-cartao">
                  <span className="financeiro-stat-label">TOTAL RECEBIDO</span>
                  <strong>{formatCurrency(confPix.total)}</strong>
                </div>
                <div className="contas-cartao">
                  <span className="financeiro-stat-label">VAI ABATER DÍVIDA</span>
                  <strong>
                    {formatCurrency(confPix.novos.reduce((t, n) => t + n.valor, 0))}
                  </strong>
                  <span className="financeiro-td-mudo">{confPix.novos.length} loja(s)</span>
                </div>
                <div
                  className={
                    confPix.pendentes.length
                      ? "contas-cartao contas-cartao-alerta"
                      : "contas-cartao"
                  }
                >
                  <span className="financeiro-stat-label">SEM DONO</span>
                  <strong>{confPix.pendentes.length}</strong>
                  <span className="financeiro-td-mudo">
                    {formatCurrency(confPix.pendentes.reduce((t, p) => t + p.valor, 0))}
                  </span>
                </div>
                {confPix.jaImportados.transacoes > 0 && (
                  <div className="contas-cartao">
                    <span className="financeiro-stat-label">JÁ IMPORTADO</span>
                    <strong>{confPix.jaImportados.transacoes}</strong>
                    <span className="financeiro-td-mudo">
                      {formatCurrency(confPix.jaImportados.valor)} — não entra de novo
                    </span>
                  </div>
                )}
              </div>

              {confPix.adotaveis.transacoes > 0 && (
                <div className="credito-alerta">
                  <p>
                    <strong>
                      {confPix.adotaveis.transacoes} PIX já tinham pagamento lançado na mão
                    </strong>{" "}
                    — {formatCurrency(confPix.adotaveis.valor)}. Eles não viram pagamento novo:
                    o PIX se amarra no que já existe, então o valor não conta duas vezes.
                  </p>
                </div>
              )}

              {confPix.pendentes.length > 0 && (
                <>
                  <h3>Quem são estes? ({confPix.pendentes.length})</h3>
                  <p className="financeiro-td-mudo">
                    Apareceram no relatório e o sistema não sabe de quem são. Aponte cada um: se
                    for loja, abate a dívida dela; aporte e venda avulsa entram no caixa sem
                    abater ninguém; transferência entre contas próprias fica de fora do
                    faturamento.
                  </p>
                  <div className="financeiro-tabela-wrap">
                    <table className="financeiro-tabela">
                      <thead>
                        <tr>
                          <th>PAGADOR</th>
                          <th>BANCO</th>
                          <th className="financeiro-th-numero">PIX</th>
                          <th className="financeiro-th-numero">VALOR</th>
                          <th>PERÍODO</th>
                          <th>É DE QUEM?</th>
                        </tr>
                      </thead>
                      <tbody>
                        {confPix.pendentes.map((p) => (
                          <tr key={p.pagador}>
                            <td>{p.pagador}</td>
                            <td className="financeiro-td-mudo">{p.instituicao}</td>
                            <td className="financeiro-th-numero">{p.transacoes}</td>
                            <td className="financeiro-th-numero">{formatCurrency(p.valor)}</td>
                            <td className="financeiro-td-mudo">
                              {p.primeira === p.ultima
                                ? p.primeira
                                : `${p.primeira} a ${p.ultima}`}
                            </td>
                            <td>
                              <select
                                className="clonar-input fabricacao-input-pequeno"
                                value={pixEscolha[p.pagador] ?? ""}
                                onChange={(e) =>
                                  setPixEscolha((v) => ({ ...v, [p.pagador]: e.target.value }))
                                }
                              >
                                <option value="">escolha...</option>
                                {clientes.map((c) => (
                                  <option key={c.id} value={String(c.id)}>
                                    {c.nome}
                                  </option>
                                ))}
                                <option value="APORTE">— aporte de sócio</option>
                                <option value="AVULSA">— venda avulsa</option>
                                <option value="IGNORAR">— transferência própria</option>
                              </select>{" "}
                              <button
                                type="button"
                                className="btn-responder"
                                disabled={!pixEscolha[p.pagador] || pixOcupado}
                                onClick={() => void apontarPendente(p.pagador)}
                              >
                                Gravar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {confPix.novos.length > 0 && (
                <>
                  <h3>Vai abater a dívida destas lojas</h3>
                  <div className="financeiro-tabela-wrap">
                    <table className="financeiro-tabela">
                      <thead>
                        <tr>
                          <th>LOJA</th>
                          <th className="financeiro-th-numero">PIX</th>
                          <th className="financeiro-th-numero">VALOR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {confPix.novos.map((n) => (
                          <tr key={n.clienteId}>
                            <td>{n.clienteNome}</td>
                            <td className="financeiro-th-numero">{n.transacoes}</td>
                            <td className="financeiro-th-numero">{formatCurrency(n.valor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {confPix.semDivida.length > 0 && (
                <p className="financeiro-td-mudo">
                  Fora da dívida:{" "}
                  {confPix.semDivida
                    .map(
                      (d) =>
                        `${d.destino.toLowerCase()} ${d.transacoes} PIX ${formatCurrency(d.valor)}`
                    )
                    .join(" · ")}
                  . Entram no caixa, mas não abatem a conta de ninguém.
                </p>
              )}
            </>
          )}

          {origensPix.length > 0 && (
            <>
              <h3>Origens já conhecidas ({origensPix.length})</h3>
              <p className="financeiro-td-mudo">
                Uma loja pode pagar por mais de um CNPJ — a Modal manda pela MODALTINTAS e pela
                GOMES E TAVARES, a Truck por duas empresas. Cada nome vira uma origem apontando
                pra mesma loja.
              </p>
              <div className="financeiro-tabela-wrap">
                <table className="financeiro-tabela">
                  <thead>
                    <tr>
                      <th>PAGADOR NO BANCO</th>
                      <th>VAI PARA</th>
                      <th className="financeiro-th-numero">PIX</th>
                      <th className="financeiro-th-numero">RECEBIDO</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {origensPix.map((o) => (
                      <tr key={o.id}>
                        <td>{o.nome}</td>
                        <td>
                          {o.destino === "CLIENTE"
                            ? (o.clienteNome ?? "loja apagada")
                            : o.destino === "APORTE"
                              ? "aporte de sócio"
                              : o.destino === "AVULSA"
                                ? "venda avulsa"
                                : "transferência própria"}
                        </td>
                        <td className="financeiro-th-numero">{o.transacoes}</td>
                        <td className="financeiro-th-numero">{formatCurrency(o.recebido)}</td>
                        <td>
                          <button
                            type="button"
                            className="btn-excluir"
                            disabled={pixOcupado}
                            onClick={async () => {
                              if (!window.confirm(`Esquecer a origem ${o.nome}?`)) return;
                              setOrigensPix(await excluirOrigemPix(o.id));
                            }}
                          >
                            Esquecer
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {aba === "entrada" && (
        <>
          <div className="financeiro-topo">
            <div>
              <h2>Entrada de mercadoria</h2>
              <p className="financeiro-td-mudo">
                É por aqui que o estoque sobe. O cálculo do saldo é{" "}
                <strong>produzido + entrado − vendido</strong>, e até agora só existia o
                produzido — que vem de lote de fábrica. Como 93% do que a distribuidora vende
                é comprado e não fabricado, a venda baixava e nada subia: em agosto de 2026
                eram 712 produtos com saldo negativo, 27.191 unidades.
              </p>
              <p className="financeiro-td-mudo">
                Suba a nota do fornecedor como arquivo. Precisa ter <strong>SKU</strong> e{" "}
                <strong>quantidade</strong>; o custo pode vir unitário ou como total da linha —
                com a quantidade, um resolve o outro. Nada entra antes de você conferir.
              </p>
            </div>
          </div>

          <div className="financeiro-filtros">
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder="Fornecedor"
              value={notaFornecedor}
              onChange={(e) => setNotaFornecedor(e.target.value)}
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder="Nº da nota"
              value={notaDocumento}
              onChange={(e) => setNotaDocumento(e.target.value)}
            />
            <input
              type="date"
              className="clonar-input fabricacao-input-pequeno"
              value={notaData}
              onChange={(e) => setNotaData(e.target.value)}
            />
            <input
              ref={notaInputRef}
              type="file"
              accept=".xlsx,.csv,.tsv,.txt"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                e.target.value = "";
                setNotaArquivo(f);
                if (f) void conferirArquivoNota(f);
              }}
            />
            <button
              type="button"
              className="btn-excluir"
              disabled={notaOcupada}
              onClick={() => notaInputRef.current?.click()}
            >
              {notaArquivo ? `Trocar nota (${notaArquivo.name})` : "Escolher nota .xlsx"}
            </button>
            <button
              type="button"
              className="btn-responder"
              disabled={!confNota?.prontas.length || notaOcupada}
              onClick={() => void lancarNota()}
            >
              {notaOcupada ? "Processando..." : `Lançar ${confNota?.prontas.length ?? 0} itens`}
            </button>
          </div>

          {confNota && (
            <>
              <div className="contas-cartoes">
                <div className="contas-cartao">
                  <span className="financeiro-stat-label">NO ARQUIVO</span>
                  <strong>{confNota.linhasNoArquivo}</strong>
                  {confNota.linhasVazias > 0 && (
                    <span className="financeiro-td-mudo">
                      {confNota.linhasVazias} em branco
                    </span>
                  )}
                </div>
                <div className="contas-cartao">
                  <span className="financeiro-stat-label">ENTRA NO ESTOQUE</span>
                  <strong>{confNota.quantidade}</strong>
                  <span className="financeiro-td-mudo">
                    {confNota.prontas.length} produto(s)
                  </span>
                </div>
                <div className="contas-cartao">
                  <span className="financeiro-stat-label">CUSTO DA NOTA</span>
                  <strong>{formatCurrency(confNota.total)}</strong>
                </div>
                <div
                  className={
                    confNota.pendentes.length
                      ? "contas-cartao contas-cartao-alerta"
                      : "contas-cartao"
                  }
                >
                  <span className="financeiro-stat-label">NÃO ENTRA</span>
                  <strong>{confNota.pendentes.length}</strong>
                </div>
              </div>

              {confNota.pendentes.length > 0 && (
                <>
                  <h3>Estas linhas não entram ({confNota.pendentes.length})</h3>
                  <div className="financeiro-tabela-wrap">
                    <table className="financeiro-tabela">
                      <thead>
                        <tr>
                          <th>LINHA</th>
                          <th>SKU NA NOTA</th>
                          <th className="financeiro-th-numero">QTDE</th>
                          <th>O QUE IMPEDE</th>
                        </tr>
                      </thead>
                      <tbody>
                        {confNota.pendentes.map((l) => (
                          <tr key={l.linha}>
                            <td>{l.linha}</td>
                            <td>{l.sku || <em>vazio</em>}</td>
                            <td className="financeiro-th-numero">{l.quantidade}</td>
                            <td>{l.problema}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="financeiro-td-mudo">
                    SKU não cadastrado: cadastre o produto e suba a nota de novo. O resto da
                    nota entra normalmente — só estas ficam de fora.
                  </p>
                </>
              )}

              {confNota.prontas.length > 0 && (
                <>
                  <h3>Vai entrar no estoque</h3>
                  <div className="financeiro-tabela-wrap">
                    <table className="financeiro-tabela">
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>PRODUTO</th>
                          <th className="financeiro-th-numero">QTDE</th>
                          <th className="financeiro-th-numero">CUSTO UNIT.</th>
                          <th className="financeiro-th-numero">TOTAL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {confNota.prontas.map((l) => (
                          <tr key={l.linha}>
                            <td>{l.sku}</td>
                            <td className="financeiro-td-mudo">{l.produtoNome}</td>
                            <td className="financeiro-th-numero">{l.quantidade}</td>
                            <td className="financeiro-th-numero">
                              {formatCurrency(l.custoUnitario)}
                            </td>
                            <td className="financeiro-th-numero">{formatCurrency(l.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}

          {entradas.length > 0 && (
            <>
              <h3>Notas lançadas ({entradas.length})</h3>
              <div className="financeiro-tabela-wrap">
                <table className="financeiro-tabela">
                  <thead>
                    <tr>
                      <th>DATA</th>
                      <th>FORNECEDOR</th>
                      <th>Nº DA NOTA</th>
                      <th className="financeiro-th-numero">ITENS</th>
                      <th className="financeiro-th-numero">QTDE</th>
                      <th className="financeiro-th-numero">CUSTO</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {entradas.map((e) => (
                      <tr key={e.id}>
                        <td>{e.data}</td>
                        <td>{e.fornecedorNome ?? <em>sem fornecedor</em>}</td>
                        <td>{e.documento ?? "—"}</td>
                        <td className="financeiro-th-numero">{e.itens.length}</td>
                        <td className="financeiro-th-numero">{e.quantidade}</td>
                        <td className="financeiro-th-numero">{formatCurrency(e.total)}</td>
                        <td>
                          <button
                            type="button"
                            className="btn-excluir"
                            onClick={async () => {
                              if (
                                !window.confirm(
                                  `Excluir a entrada de ${e.data}? O estoque desce ${e.quantidade} unidades.`
                                )
                              ) {
                                return;
                              }
                              try {
                                await excluirEntrada(e.id);
                                await carregarEntradas();
                                await carregar();
                                setAviso("Entrada excluída. O estoque voltou.");
                              } catch (err) {
                                setErro(
                                  err instanceof Error ? err.message : "Falha ao excluir."
                                );
                              }
                            }}
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
        </>
      )}
    </div>
  );
}
