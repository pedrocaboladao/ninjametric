import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchContas,
  fetchResumoContas,
  criarConta,
  atualizarConta,
  definirStatusConta,
  excluirConta,
} from "../api/fabricaContas";
import type { Conta, ContaEntrada, ResumoContas, StatusConta } from "../types/fabricaContas";
import { formatCurrency } from "../utils/format";
import { IconPlus } from "./icons";
import { BotaoExcluir } from "./BotaoExcluir";
import { FabricaDre } from "./FabricaDre";

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
  "EMBALAGEM",
  "MANUTENÇÃO",
  "IMPOSTO",
  "FRETE",
  "CONSUMO",
  "OUTROS",
];

const VAZIO = {
  descricao: "",
  categoria: "",
  contraparte: "",
  valor: "",
  vencimento: "",
  status: "pendente" as StatusConta,
  dataPagamento: "",
  custoFixo: true,
  observacao: "",
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
  const [aba, setAba] = useState<"contas" | "dre">("contas");

  const [filtroStatus, setFiltroStatus] = useState<"" | StatusConta>("");

  const carregar = useCallback(async () => {
    try {
      const [cs, r] = await Promise.all([
        fetchContas({ tipo: "pagar", status: filtroStatus || undefined }),
        fetchResumoContas(),
      ]);
      setContas(cs);
      setResumo(r);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.");
      setContas([]);
    }
  }, [filtroStatus]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const atrasadas = useMemo(() => (contas ?? []).filter((c) => c.atrasada), [contas]);

  function novo() {
    setEditandoId(null);
    setForm({ ...VAZIO, vencimento: hoje() });
    setMostrarForm(true);
    setErro(null);
  }

  function editar(c: Conta) {
    setEditandoId(c.id);
    setForm({
      descricao: c.descricao,
      categoria: c.categoria ?? "",
      contraparte: c.contraparte ?? "",
      valor: String(c.valor),
      vencimento: c.vencimento,
      status: c.status,
      dataPagamento: c.dataPagamento ?? "",
      custoFixo: c.custoFixo,
      observacao: c.observacao ?? "",
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
      // a fábrica só lança a pagar aqui: o a receber vem dos pedidos de venda
      tipo: "pagar",
      descricao: form.descricao.trim(),
      categoria: form.categoria || null,
      contraparte: form.contraparte.trim() || null,
      valor: num(form.valor),
      vencimento: form.vencimento,
      status: form.status,
      dataPagamento: form.dataPagamento || null,
      custoFixo: form.custoFixo,
      observacao: form.observacao.trim() || null,
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

      {erro && <p className="financeiro-td-mudo">{erro}</p>}
      {aviso && <p className="financeiro-td-mudo">{aviso}</p>}

      <div className="financeiro-filtros">
        {(["contas", "dre"] as const).map((a) => (
          <button
            key={a}
            type="button"
            className={aba === a ? "btn-responder" : "btn-excluir"}
            onClick={() => setAba(a)}
          >
            {a === "contas" ? "Contas a pagar" : "DRE"}
          </button>
        ))}
      </div>

      {aba === "dre" && <FabricaDre />}

      {aba === "contas" && resumo && (
        <div className="financeiro-filtros">
          <div>
            <div className="financeiro-stat-label">CUSTO FIXO</div>
            <div className="financeiro-stat-valor">{formatCurrency(resumo.custoFixo)}</div>
          </div>
          <div>
            <div className="financeiro-stat-label">CUSTO VARIÁVEL</div>
            <div className="financeiro-stat-valor">{formatCurrency(resumo.custoVariavel)}</div>
          </div>
          <div>
            <div className="financeiro-stat-label">JÁ PAGO</div>
            <div className="financeiro-stat-valor">{formatCurrency(resumo.pago)}</div>
          </div>
          <div>
            <div className="financeiro-stat-label">AS LOJAS DEVEM</div>
            <div className="financeiro-stat-valor">{formatCurrency(resumo.aReceber)}</div>
          </div>
        </div>
      )}

      {aba === "contas" && (
      <div className="financeiro-filtros">
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
        <button type="button" className="btn-responder" onClick={novo}>
          <IconPlus size={14} /> Nova conta
        </button>
      </div>
      )}

      {aba === "contas" && mostrarForm && (
        <>
          <div className="financeiro-filtros">
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
              placeholder="Fornecedor"
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
      <div className="financeiro-tabela-wrap">
        <table className="financeiro-tabela">
          <thead>
            <tr>
              <th>VENCIMENTO</th>
              <th>DESCRIÇÃO</th>
              <th>CATEGORIA</th>
              <th>FORNECEDOR</th>
              <th className="financeiro-th-numero">VALOR</th>
              <th>CUSTO</th>
              <th>STATUS</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {contas === null && (
              <tr>
                <td colSpan={8}>Carregando…</td>
              </tr>
            )}
            {contas !== null && !contas.length && (
              <tr>
                <td colSpan={8}>Nenhuma conta lançada.</td>
              </tr>
            )}
            {(contas ?? []).map((c) => (
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
                <td>
                  <BotaoExcluir onConfirmar={() => void apagar(c)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="financeiro-td-mudo">
        Custo fixo e variável somam o período todo, pago ou não — o DRE olha competência, não caixa.
        Conta cancelada não entra em nada.
      </p>
      </>
      )}
    </div>
  );
}
