import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchContas,
  fetchResumoContas,
  criarConta,
  atualizarConta,
  definirStatusConta,
  excluirConta,
} from "../api/fabricaContas";
import type {
  Conta,
  ContaEntrada,
  ResumoContas,
  StatusConta,
  TipoConta,
} from "../types/fabricaContas";
import { formatCurrency } from "../utils/format";
import { IconPlus } from "./icons";
import { BotaoExcluir } from "./BotaoExcluir";
import { FabricaDre } from "./FabricaDre";
import { FabricaBens } from "./FabricaBens";

// aceita "1.234,56" e "1234.56" — o operador digita como fala
function num(v: string): number {
  return Number(String(v).replace(/\./g, "").replace(",", ".")) || 0;
}

function data(d: string): string {
  return d.split("-").reverse().join("/");
}

// "hoje" pelo fuso de São Paulo: às 22h o UTC já virou o dia seguinte
function hoje(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

const CATEGORIAS = [
  "ALUGUEL",
  "ÁGUA",
  "LUZ",
  "SALÁRIO",
  "MATÉRIA-PRIMA",
  // produto pronto comprado pra revender: é custo de mercadoria, não despesa.
  // Enquanto a fábrica não fabrica, é aqui que entra quase todo o dinheiro.
  "REVENDA",
  "EMBALAGEM",
  "MANUTENÇÃO",
  "IMPOSTO",
  "FRETE",
  "CONSUMO",
  "OUTROS",
];

// O que a planilha do financeiro usa. Texto livre no banco: forma nova nao
// pode derrubar o lancamento.
const FORMAS = ["Boleto", "Cheque", "Pix", "Transferência", "Dinheiro"];

// A natureza responde uma pergunta diferente da categoria: categoria diz no
// que o dinheiro foi (aluguel, luz), natureza diz como ele se comporta.
type Natureza = "" | "fixo" | "variavel" | "revenda";

const CATEGORIA_REVENDA = "REVENDA";

function naturezaDa(c: Conta): Exclude<Natureza, ""> {
  if (c.categoria === CATEGORIA_REVENDA) return "revenda";
  return c.custoFixo ? "fixo" : "variavel";
}

const ROTULO_NATUREZA: Record<Exclude<Natureza, "">, string> = {
  fixo: "Custo fixo",
  variavel: "Custo variável",
  revenda: "Revenda",
};

const VAZIO = {
  tipo: "pagar" as TipoConta,
  descricao: "",
  categoria: "",
  contraparte: "",
  valor: "",
  vencimento: "",
  status: "pendente" as StatusConta,
  dataPagamento: "",
  custoFixo: true,
  observacao: "",
  formaPagamento: "",
  documento: "",
  repetirMeses: "0",
};

export function FabricaContas() {
  const [contas, setContas] = useState<Conta[] | null>(null);
  const [resumo, setResumo] = useState<ResumoContas | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...VAZIO });
  const [mostrarForm, setMostrarForm] = useState(false);
  const [aba, setAba] = useState<"contas" | "dre" | "bens">("contas");

  const [filtroStatus, setFiltroStatus] = useState<"" | StatusConta>("");
  const [filtroTipo, setFiltroTipo] = useState<TipoConta>("pagar");
  const [filtroNatureza, setFiltroNatureza] = useState<Natureza>("");
  // o mes corrente inteiro: e o recorte que o operador quer ver 9 vezes em 10
  const [de, setDe] = useState(() => hoje().slice(0, 8) + "01");
  const [ate, setAte] = useState(() => {
    const [ano, mes] = hoje().split("-").map(Number);
    const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    return `${hoje().slice(0, 8)}${ultimo}`;
  });

  const carregar = useCallback(async () => {
    try {
      const [cs, r] = await Promise.all([
        fetchContas({
          tipo: filtroTipo,
          status: filtroStatus || undefined,
          de: de || undefined,
          ate: ate || undefined,
        }),
        fetchResumoContas(),
      ]);
      setContas(cs);
      setResumo(r);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.");
      setContas([]);
    }
  }, [filtroStatus, filtroTipo, de, ate]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // o filtro de natureza e da tela, nao do servidor: a lista ja veio inteira e
  // filtrar aqui deixa o total por categoria acompanhar na hora
  const visiveis = useMemo(
    () => (contas ?? []).filter((c) => !filtroNatureza || naturezaDa(c) === filtroNatureza),
    [contas, filtroNatureza]
  );

  const atrasadas = useMemo(() => visiveis.filter((c) => c.atrasada), [visiveis]);

  const porNatureza = useMemo(() => {
    const m = { fixo: 0, variavel: 0, revenda: 0 };
    for (const c of contas ?? []) {
      if (c.status === "cancelado") continue;
      m[naturezaDa(c)] += c.valor;
    }
    return m;
  }, [contas]);

  // "ja pago" vinha do resumo do servidor, que ignora o filtro de periodo: a
  // tela mostrava agosto e o numero falava do ano inteiro
  const pagoNoPeriodo = useMemo(
    () =>
      (contas ?? [])
        .filter((c) => c.status === "pago")
        .reduce((s, c) => s + c.valor, 0),
    [contas]
  );

  const faltaPagar = useMemo(
    () =>
      (contas ?? [])
        .filter((c) => c.status === "pendente")
        .reduce((s, c) => s + c.valor, 0),
    [contas]
  );

  const porCategoria = useMemo(() => {
    const m = new Map<
      string,
      { total: number; pago: number; n: number; naturezas: Set<string> }
    >();
    for (const c of visiveis) {
      if (c.status === "cancelado") continue;
      const k = c.categoria ?? "SEM CATEGORIA";
      const linha = m.get(k) ?? { total: 0, pago: 0, n: 0, naturezas: new Set<string>() };
      linha.total += c.valor;
      if (c.status === "pago") linha.pago += c.valor;
      linha.n += 1;
      // a mesma categoria pode ter conta fixa e variavel: mostrar "misto" em
      // vez de escolher uma evita afirmar o que nao e verdade
      linha.naturezas.add(naturezaDa(c));
      m.set(k, linha);
    }
    return [...m.entries()]
      .map(([categoria, v]) => ({ categoria, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [visiveis]);

  function novo() {
    setEditandoId(null);
    setForm({ ...VAZIO, vencimento: hoje() });
    setMostrarForm(true);
    setErro(null);
  }

  function editar(c: Conta) {
    setEditandoId(c.id);
    setForm({
      tipo: c.tipo,
      descricao: c.descricao,
      categoria: c.categoria ?? "",
      contraparte: c.contraparte ?? "",
      valor: String(c.valor),
      vencimento: c.vencimento,
      status: c.status,
      dataPagamento: c.dataPagamento ?? "",
      custoFixo: c.custoFixo,
      observacao: c.observacao ?? "",
      formaPagamento: c.formaPagamento ?? "",
      documento: c.documento ?? "",
      // repetir só faz sentido ao criar: editar uma conta não multiplica ela
      repetirMeses: "0",
    });
    setMostrarForm(true);
    setErro(null);
  }

  async function salvar() {
    if (!form.descricao.trim()) return setErro("Informe a descrição.");
    if (num(form.valor) <= 0) return setErro("Informe o valor.");
    if (!form.vencimento) return setErro("Informe o vencimento.");

    const entrada: ContaEntrada = {
      // Enquanto a fábrica só revende, o a receber é digitado aqui. Quando os
      // produtos estiverem cadastrados, ele passa a nascer do pedido de venda.
      tipo: form.tipo,
      descricao: form.descricao.trim(),
      categoria: form.categoria || null,
      contraparte: form.contraparte.trim() || null,
      valor: num(form.valor),
      vencimento: form.vencimento,
      status: form.status,
      dataPagamento: form.dataPagamento || null,
      custoFixo: form.custoFixo,
      observacao: form.observacao.trim() || null,
      formaPagamento: form.formaPagamento || null,
      documento: form.documento.trim() || null,
      repetirMeses: Number(form.repetirMeses) || 0,
    };
    setSalvando(true);
    try {
      if (editandoId) {
        await atualizarConta(editandoId, entrada);
        setAviso("Conta salva.");
      } else {
        const r = await criarConta(entrada);
        setAviso(
          r.ids.length > 1 ? `${r.ids.length} contas criadas, uma por mês.` : "Conta lançada."
        );
      }
      setMostrarForm(false);
      setEditandoId(null);
      setForm({ ...VAZIO });
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function marcar(c: Conta, status: StatusConta) {
    try {
      await definirStatusConta(c.id, status);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao mudar o status.");
    }
  }

  async function apagar(c: Conta) {
    try {
      await excluirConta(c.id);
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
          <h1>Financeiro da fábrica</h1>
          <p className="financeiro-td-mudo">
            O barracão da fabricação paga aluguel, água e luz próprios. Isto é outra empresa: nada
            aqui encosta no financeiro das lojas, e a loja chamada Fábrica de Tintas continua lá
            junto com as outras.
          </p>
        </div>
        <div>
          <div className="financeiro-stat-label">
            {atrasadas.length ? `${atrasadas.length} ATRASADA${atrasadas.length > 1 ? "S" : ""}` : "A PAGAR"}
          </div>
          <div className="financeiro-stat-valor">
            {formatCurrency(atrasadas.length ? resumo?.atrasado ?? 0 : resumo?.aPagar ?? 0)}
          </div>
        </div>
      </div>

      {erro && <p className="financeiro-td-mudo ordem-sem-impressao">{erro}</p>}
      {aviso && <p className="financeiro-td-mudo ordem-sem-impressao">{aviso}</p>}

      <p className="contas-cabecalho-impressao">
        {filtroTipo === "receber" ? "Contas a receber" : "Contas a pagar"} da Fábrica
        Distribuidora · vencimento de {data(de)} a {data(ate)}
        {filtroNatureza && ` · só ${ROTULO_NATUREZA[filtroNatureza].toLowerCase()}`}
        {filtroStatus && ` · só ${filtroStatus}`}
      </p>

      <div className="financeiro-filtros ordem-sem-impressao">
        {(["contas", "dre", "bens"] as const).map((a) => (
          <button
            key={a}
            type="button"
            className={aba === a ? "btn-responder" : "btn-excluir"}
            onClick={() => setAba(a)}
          >
            {a === "contas" ? "Contas a pagar" : a === "dre" ? "DRE" : "Bens"}
          </button>
        ))}
      </div>

      {aba === "dre" && <FabricaDre />}
      {aba === "bens" && <FabricaBens />}

      {aba === "contas" && (
        <div className="contas-cartoes">
          {(["fixo", "variavel", "revenda"] as const).map((n) => (
            <button
              key={n}
              type="button"
              className={`contas-cartao${filtroNatureza === n ? " contas-cartao-ativo" : ""}`}
              onClick={() => setFiltroNatureza((v) => (v === n ? "" : n))}
              title={
                filtroNatureza === n ? "Clique para ver tudo de novo" : "Clique para ver só estas"
              }
            >
              <div className="financeiro-stat-label">{ROTULO_NATUREZA[n].toUpperCase()}</div>
              <div className="financeiro-stat-valor">{formatCurrency(porNatureza[n])}</div>
              {filtroNatureza === n && <div className="contas-cartao-marca">filtrando</div>}
            </button>
          ))}
          <div className="contas-cartao">
            <div className="financeiro-stat-label">PAGO NO PERÍODO</div>
            <div className="financeiro-stat-valor">{formatCurrency(pagoNoPeriodo)}</div>
          </div>
          <div className="contas-cartao">
            <div className="financeiro-stat-label">FALTA PAGAR</div>
            <div className="financeiro-stat-valor">{formatCurrency(faltaPagar)}</div>
          </div>
        </div>
      )}

      {aba === "contas" && (
      <div className="financeiro-filtros ordem-sem-impressao">
        <select
          className="clonar-input fabricacao-input-pequeno"
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value as TipoConta)}
        >
          <option value="pagar">A pagar</option>
          <option value="receber">A receber</option>
        </select>
        <select
          className="clonar-input fabricacao-input-pequeno"
          value={filtroNatureza}
          onChange={(e) => setFiltroNatureza(e.target.value as Natureza)}
        >
          <option value="">Fixo, variável e revenda</option>
          <option value="fixo">Só custo fixo</option>
          <option value="variavel">Só custo variável</option>
          <option value="revenda">Só revenda</option>
        </select>
        <select
          className="clonar-input fabricacao-input-pequeno"
          value={filtroStatus}
          onChange={(e) => setFiltroStatus(e.target.value as "" | StatusConta)}
        >
          <option value="">Todos os status</option>
          <option value="pendente">Pendente</option>
          <option value="pago">Pago</option>
          <option value="cancelado">Cancelado</option>
        </select>
        <input
          className="clonar-input fabricacao-input-pequeno"
          type="date"
          value={de}
          onChange={(e) => setDe(e.target.value)}
          title="Vencimento a partir de"
        />
        <input
          className="clonar-input fabricacao-input-pequeno"
          type="date"
          value={ate}
          onChange={(e) => setAte(e.target.value)}
          title="Vencimento até"
        />
        <button type="button" className="btn-responder" onClick={novo}>
          <IconPlus size={14} /> Nova conta
        </button>
        <button type="button" className="btn-excluir" onClick={() => window.print()}>
          Imprimir
        </button>
      </div>
      )}

      {aba === "contas" && mostrarForm && (
        <>
          <div className="financeiro-filtros">
            <select
              className="clonar-input fabricacao-input-pequeno"
              value={form.tipo}
              onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value as TipoConta }))}
            >
              <option value="pagar">A pagar</option>
              <option value="receber">A receber</option>
            </select>
            <input
              className="clonar-input"
              placeholder="Descrição (ex: Aluguel do barracão)"
              value={form.descricao}
              onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
            />
            <select
              className="clonar-input fabricacao-input-pequeno"
              value={form.categoria}
              onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}
            >
              <option value="">Categoria</option>
              {CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder={form.tipo === "receber" ? "Cliente" : "Fornecedor"}
              value={form.contraparte}
              onChange={(e) => setForm((f) => ({ ...f, contraparte: e.target.value }))}
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder="Valor"
              value={form.valor}
              onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))}
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              type="date"
              value={form.vencimento}
              onChange={(e) => setForm((f) => ({ ...f, vencimento: e.target.value }))}
            />
            <select
              className="clonar-input fabricacao-input-pequeno"
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as StatusConta }))}
            >
              <option value="pendente">Pendente</option>
              <option value="pago">Pago</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </div>

          <div className="financeiro-filtros">
            <label className="financeiro-td-mudo">
              <input
                type="checkbox"
                checked={form.custoFixo}
                onChange={(e) => setForm((f) => ({ ...f, custoFixo: e.target.checked }))}
              />{" "}
              custo fixo (aluguel, salário) — desmarque o que varia com a produção
            </label>
            <select
              className="clonar-input fabricacao-input-pequeno"
              value={form.formaPagamento}
              onChange={(e) => setForm((f) => ({ ...f, formaPagamento: e.target.value }))}
            >
              <option value="">Forma de pagamento</option>
              {FORMAS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder="Nº do documento / cheque"
              value={form.documento}
              onChange={(e) => setForm((f) => ({ ...f, documento: e.target.value }))}
              title="Nº da nota, do boleto ou do cheque — é por ele que a conciliação bancária acha a conta"
            />
            {!editandoId && (
              <input
                className="clonar-input fabricacao-input-pequeno"
                placeholder="Repetir por N meses"
                value={form.repetirMeses}
                onChange={(e) => setForm((f) => ({ ...f, repetirMeses: e.target.value }))}
                title="Cria a mesma conta nos próximos meses, mantendo o dia do vencimento"
              />
            )}
            <input
              className="clonar-input"
              placeholder="Observação"
              value={form.observacao}
              onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))}
            />
          </div>

          <div className="financeiro-filtros">
            <button type="button" className="btn-responder" onClick={() => void salvar()} disabled={salvando}>
              {editandoId ? "Salvar" : "Lançar"}
            </button>
            <button
              type="button"
              className="btn-excluir"
              onClick={() => {
                setMostrarForm(false);
                setEditandoId(null);
              }}
            >
              Cancelar
            </button>
          </div>
        </>
      )}

      {aba === "contas" && (
      <>
      {aba === "contas" && porCategoria.length > 0 && (
        <div className="financeiro-tabela-wrap">
          <table className="financeiro-tabela">
            <thead>
              <tr>
                <th>CATEGORIA</th>
                <th>NATUREZA</th>
                <th className="financeiro-th-numero">LANÇAMENTOS</th>
                <th className="financeiro-th-numero">TOTAL</th>
                <th className="financeiro-th-numero">JÁ PAGO</th>
                <th className="financeiro-th-numero">FALTA PAGAR</th>
              </tr>
            </thead>
            <tbody>
              {porCategoria.map((c) => (
                <tr key={c.categoria}>
                  <td>{c.categoria}</td>
                  <td className="financeiro-td-mudo">
                    {c.naturezas.size > 1
                      ? "misto"
                      : ROTULO_NATUREZA[
                          [...c.naturezas][0] as Exclude<Natureza, "">
                        ].toLowerCase()}
                  </td>
                  <td className="financeiro-th-numero financeiro-td-mudo">{c.n}</td>
                  <td className="financeiro-th-numero">{formatCurrency(c.total)}</td>
                  <td className="financeiro-th-numero financeiro-td-mudo">
                    {formatCurrency(c.pago)}
                  </td>
                  <td className="financeiro-th-numero">{formatCurrency(c.total - c.pago)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="financeiro-tabela-wrap">
        <table className="financeiro-tabela contas-tabela-lancamentos">
          <thead>
            <tr>
              <th>VENCIMENTO</th>
              <th>DESCRIÇÃO</th>
              <th>CATEGORIA</th>
              <th>{filtroTipo === "receber" ? "CLIENTE" : "FORNECEDOR"}</th>
              <th>PAGAMENTO</th>
              <th className="financeiro-th-numero">VALOR</th>
              <th>CUSTO</th>
              <th>STATUS</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {contas === null && (
              <tr>
                <td colSpan={9}>Carregando…</td>
              </tr>
            )}
            {contas !== null && !visiveis.length && (
              <tr>
                <td colSpan={9}>Nenhuma conta lançada.</td>
              </tr>
            )}
            {visiveis.map((c) => (
              <tr key={c.id} style={c.status === "cancelado" ? { opacity: 0.5 } : undefined}>
                <td className={c.atrasada ? undefined : "financeiro-td-mudo"}>
                  {data(c.vencimento)}
                  {c.atrasada && ` · ${Math.abs(c.diasParaVencer)}d atrasada`}
                </td>
                <td>
                  <button type="button" className="fabricacao-envase-nome-editavel" onClick={() => editar(c)}>
                    {c.descricao}
                  </button>
                </td>
                <td className="financeiro-td-mudo">{c.categoria ?? "—"}</td>
                <td className="financeiro-td-mudo">{c.contraparte ?? "—"}</td>
                <td className="financeiro-td-mudo">
                  {c.formaPagamento ?? "—"}
                  {c.documento && ` · ${c.documento}`}
                </td>
                <td className="financeiro-th-numero">{formatCurrency(c.valor)}</td>
                <td className="financeiro-td-mudo">{c.custoFixo ? "fixo" : "variável"}</td>
                <td>
                  <select
                    className="clonar-input fabricacao-input-pequeno"
                    value={c.status}
                    onChange={(e) => void marcar(c, e.target.value as StatusConta)}
                  >
                    <option value="pendente">Pendente</option>
                    <option value="pago">Pago</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                </td>
                <td className="contas-acoes">
                  <button type="button" className="btn-excluir" onClick={() => editar(c)}>
                    Editar
                  </button>
                  <BotaoExcluir onConfirmar={() => void apagar(c)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="financeiro-td-mudo ordem-sem-impressao">
        Custo fixo e variável somam o período todo, pago ou não — o DRE olha competência, não caixa.
        Conta cancelada não entra em nada. Para corrigir um valor que subiu ou um lançamento errado,
        clique em <strong>Editar</strong> (ou no nome da conta).
      </p>
      </>
      )}
    </div>
  );
}
