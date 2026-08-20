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
} from "../api/fabricaPedidos";
import { fetchFabricaClientes } from "../api/fabricaClientes";
import { fetchFabricaProdutos } from "../api/fabricaProdutos";
import type {
  Pedido,
  PedidoEntrada,
  StatusPedido,
  EstoqueProduto,
  AjusteProduto,
} from "../types/fabricaPedidos";
import type { FabricaCliente } from "../types/fabricaClientes";
import type { FabricaProduto } from "../types/fabricaProdutos";
import { formatCurrency } from "../utils/format";
import { IconPlus, IconTrash } from "./icons";

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
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aba, setAba] = useState<"pedidos" | "novo" | "estoque">("pedidos");
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
  const saldoPor = useMemo(() => new Map(estoque.map((e) => [e.produtoId, e])), [estoque]);

  const totais = useMemo(() => {
    const lista = (pedidos ?? []).filter((p) => p.status !== "CANCELADO");
    const total = lista.reduce((s, p) => s + p.total, 0);
    const custo = lista.reduce((s, p) => s + p.custoTotal, 0);
    return { total, custo, margem: total - custo, pedidos: lista.length };
  }, [pedidos]);

  const alertas = useMemo(() => estoque.filter((e) => e.abaixoDoMinimo), [estoque]);

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
    if (!confirm(`Excluir o pedido ${p.id} de ${p.clienteNome}?`)) return;
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
    if (!confirm(`Excluir o ajuste de ${a.quantidade} em ${a.produtoNome}?`)) return;
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
        {(["pedidos", "novo", "estoque"] as const).map((a) => (
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
                : `Estoque de produto${alertas.length ? ` (${alertas.length})` : ""}`}
          </button>
        ))}
      </div>

      {aba === "pedidos" && (
        <>
          <div className="financeiro-filtros">
            <select
              className="clonar-input"
              value={filtroCliente}
              onChange={(e) => setFiltroCliente(e.target.value)}
            >
              <option value="">Todos os clientes</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
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
                      <button
                        type="button"
                        className="btn-excluir"
                        onClick={() => void apagar(p)}
                        title="Excluir"
                      >
                        <IconTrash size={14} />
                      </button>
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
            <select className="clonar-input" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
              <option value="">Cliente</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                  {c.tipo === "EXTERNO" ? " (de fora)" : ""}
                </option>
              ))}
            </select>
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

          <div className="financeiro-tabela-wrap">
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
                        <select
                          className="clonar-input"
                          value={l.produtoId}
                          onChange={(e) => escolherProduto(idx, e.target.value)}
                        >
                          <option value="">Produto</option>
                          {produtos
                            .filter((pr) => pr.ativo || String(pr.id) === l.produtoId)
                            .map((pr) => (
                              <option key={pr.id} value={pr.id}>
                                {pr.nome} — {pr.sku}
                              </option>
                            ))}
                        </select>
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
                    <td colSpan={8}>Nenhum produto cadastrado.</td>
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
            <select
              className="clonar-input"
              value={ajusteProdutoId}
              onChange={(e) => setAjusteProdutoId(e.target.value)}
            >
              <option value="">Produto</option>
              {estoque.map((e) => (
                <option key={e.produtoId} value={e.produtoId}>
                  {e.nome} — saldo {e.saldo}
                </option>
              ))}
            </select>
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
                      <button
                        type="button"
                        className="btn-excluir"
                        onClick={() => void apagarAjuste(a)}
                        title="Excluir"
                      >
                        <IconTrash size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
