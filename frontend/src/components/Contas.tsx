import { useCallback, useEffect, useState } from "react";
import {
  fetchLancamentos,
  fetchResumoContas,
  criarLancamento,
  atualizarLancamento,
  marcarComoPago,
  excluirLancamento,
} from "../api/contas";
import { fetchLojas, type Loja } from "../api/lojas";
import type { Lancamento, ResumoContas, TipoLancamento, StatusLancamento } from "../types/contas";
import type { Usuario } from "../types/usuarios";
import { formatCurrency } from "../utils/format";
import { useBuscaComCancelamento } from "../hooks/useBuscaComCancelamento";

interface Props {
  usuario: Usuario;
}

const CATEGORIAS_SUGERIDAS = ["Fornecedor", "Aluguel", "Salário", "Imposto", "Frete", "Outros"];

function dataISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hojeISO(): string {
  return dataISO(new Date());
}

function formatDataCurta(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR");
}

function classeStatus(l: Lancamento): string {
  if (l.status === "cancelado") return "financeiro-margem-neutra";
  if (l.status === "pago") return "financeiro-margem-positiva";
  if (l.atrasado) return "financeiro-margem-negativa";
  return "financeiro-margem-alerta";
}

function labelStatus(l: Lancamento): string {
  if (l.status === "pago") return "Pago";
  if (l.status === "cancelado") return "Cancelado";
  return l.atrasado ? "Atrasado" : "Pendente";
}

interface FormState {
  lojaId: number | null;
  tipo: TipoLancamento;
  descricao: string;
  categoria: string;
  valor: string;
  vencimento: string;
  observacao: string;
}

function formVazio(lojaPadrao: number | null): FormState {
  return {
    lojaId: lojaPadrao,
    tipo: "pagar",
    descricao: "",
    categoria: "",
    valor: "",
    vencimento: hojeISO(),
    observacao: "",
  };
}

export function Contas({ usuario: _usuario }: Props) {
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [lojaFiltro, setLojaFiltro] = useState<number | "todas" | "minhas">("todas");
  const [tipoFiltro, setTipoFiltro] = useState<"" | TipoLancamento>("");
  const [statusFiltro, setStatusFiltro] = useState<"" | StatusLancamento | "atrasado">("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");

  const [formAberto, setFormAberto] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(() => formVazio(null));
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [excluindoId, setExcluindoId] = useState<number | null>(null);

  useEffect(() => {
    fetchLojas()
      .then(setLojas)
      .catch(() => {});
  }, []);

  const statusParaApi = statusFiltro === "atrasado" ? "pendente" : statusFiltro || undefined;

  const buscarLista = useCallback(
    () =>
      fetchLancamentos({
        lojaFiltro,
        tipo: tipoFiltro || undefined,
        status: statusParaApi,
        dataInicio: dataInicio && dataFim ? dataInicio : undefined,
        dataFim: dataInicio && dataFim ? dataFim : undefined,
      }),
    [lojaFiltro, tipoFiltro, statusParaApi, dataInicio, dataFim]
  );
  const {
    dados: lancamentos,
    erro: erroLista,
    atualizarAgora: recarregarLista,
  } = useBuscaComCancelamento<Lancamento[]>(buscarLista, true);

  const buscarResumo = useCallback(
    () =>
      fetchResumoContas({
        lojaFiltro,
        dataInicio: dataInicio && dataFim ? dataInicio : undefined,
        dataFim: dataInicio && dataFim ? dataFim : undefined,
      }),
    [lojaFiltro, dataInicio, dataFim]
  );
  const { dados: resumo, atualizarAgora: recarregarResumo } = useBuscaComCancelamento<ResumoContas>(buscarResumo, true);

  const listaExibida = (lancamentos ?? []).filter((l) => statusFiltro !== "atrasado" || l.atrasado);

  function recarregarTudo() {
    recarregarLista();
    recarregarResumo();
  }

  function abrirNovo() {
    setEditandoId(null);
    setForm(formVazio(lojas[0]?.id ?? null));
    setErroForm(null);
    setFormAberto(true);
  }

  function abrirEdicao(l: Lancamento) {
    setEditandoId(l.id);
    setForm({
      lojaId: l.lojaId,
      tipo: l.tipo,
      descricao: l.descricao,
      categoria: l.categoria ?? "",
      valor: String(l.valor),
      vencimento: l.vencimento,
      observacao: l.observacao ?? "",
    });
    setErroForm(null);
    setFormAberto(true);
  }

  function fecharForm() {
    setFormAberto(false);
    setEditandoId(null);
    setErroForm(null);
  }

  async function salvar() {
    const valorNum = Number(form.valor.replace(",", "."));
    if (!form.descricao.trim()) {
      setErroForm("Informe a descrição.");
      return;
    }
    if (Number.isNaN(valorNum) || valorNum <= 0) {
      setErroForm("Informe um valor maior que zero.");
      return;
    }
    if (!form.vencimento) {
      setErroForm("Informe a data de vencimento.");
      return;
    }

    setSalvando(true);
    setErroForm(null);
    try {
      if (editandoId !== null) {
        await atualizarLancamento(editandoId, {
          descricao: form.descricao.trim(),
          categoria: form.categoria.trim() || null,
          valor: valorNum,
          vencimento: form.vencimento,
          observacao: form.observacao.trim() || null,
        });
      } else {
        if (form.lojaId === null) {
          setErroForm("Selecione uma loja.");
          setSalvando(false);
          return;
        }
        await criarLancamento({
          lojaId: form.lojaId,
          tipo: form.tipo,
          descricao: form.descricao.trim(),
          categoria: form.categoria.trim() || null,
          valor: valorNum,
          vencimento: form.vencimento,
          observacao: form.observacao.trim() || null,
        });
      }
      fecharForm();
      recarregarTudo();
    } catch (err) {
      setErroForm(err instanceof Error ? err.message : "Falha ao salvar lançamento.");
    } finally {
      setSalvando(false);
    }
  }

  async function marcarPago(id: number) {
    try {
      await marcarComoPago(id);
      recarregarTudo();
    } catch {
      // erro exibido implicitamente pela lista não atualizar; simples o bastante pra não precisar de toast
    }
  }

  async function excluir(id: number) {
    if (!confirm("Excluir esse lançamento? Não tem como desfazer.")) return;
    setExcluindoId(id);
    try {
      await excluirLancamento(id);
      recarregarTudo();
    } catch {
      // idem
    } finally {
      setExcluindoId(null);
    }
  }

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <span className="painel-eyebrow">Contas a pagar e receber</span>
          <h1>Lançamentos</h1>
          <p className="painel-sub">
            Despesas e recebimentos que não vêm do Mercado Livre — fornecedor, aluguel, salário, imposto etc.
          </p>
        </div>
        <div className="financeiro-filtros">
          <select
            className="dashboard-select"
            value={lojaFiltro}
            onChange={(e) => {
              const valor = e.target.value;
              setLojaFiltro(valor === "todas" || valor === "minhas" ? valor : Number(valor));
            }}
          >
            <option value="todas">Todas as lojas</option>
            <option value="minhas">Minhas lojas</option>
            {lojas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </select>
          <select className="dashboard-select" value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value as "" | TipoLancamento)}>
            <option value="">Todos os tipos</option>
            <option value="pagar">A pagar</option>
            <option value="receber">A receber</option>
          </select>
          <select
            className="dashboard-select"
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value as "" | StatusLancamento | "atrasado")}
          >
            <option value="">Todos os status</option>
            <option value="pendente">Pendente</option>
            <option value="atrasado">Atrasado</option>
            <option value="pago">Pago</option>
            <option value="cancelado">Cancelado</option>
          </select>
          <button type="button" className="painel-estudo-gerenciar-btn" onClick={abrirNovo}>
            Novo lançamento
          </button>
        </div>
      </div>

      <div className="financeiro-filtro-datas">
        <input type="date" className="dashboard-select" value={dataInicio} max={dataFim || undefined} onChange={(e) => setDataInicio(e.target.value)} />
        <span>até</span>
        <input type="date" className="dashboard-select" value={dataFim} min={dataInicio || undefined} onChange={(e) => setDataFim(e.target.value)} />
        <span className="financeiro-stat-sub">Filtra o vencimento — deixe em branco pra ver tudo</span>
        {(dataInicio || dataFim) && (
          <button
            type="button"
            className="btn-excluir"
            onClick={() => {
              setDataInicio("");
              setDataFim("");
            }}
          >
            Limpar datas
          </button>
        )}
      </div>

      {formAberto && (
        <div className="financeiro-impostos">
          <div className="financeiro-impostos-header">
            <span>{editandoId !== null ? "Editar lançamento" : "Novo lançamento"}</span>
            <button type="button" className="btn-excluir" onClick={fecharForm}>
              Fechar
            </button>
          </div>
          {erroForm && <div className="state-message state-error">{erroForm}</div>}
          <div className="financeiro-busca">
            <select
              className="dashboard-select"
              value={form.lojaId ?? ""}
              disabled={editandoId !== null}
              onChange={(e) => setForm((f) => ({ ...f, lojaId: Number(e.target.value) }))}
            >
              <option value="" disabled>
                Loja...
              </option>
              {lojas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </select>
            <select
              className="dashboard-select"
              value={form.tipo}
              disabled={editandoId !== null}
              onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value as TipoLancamento }))}
            >
              <option value="pagar">A pagar</option>
              <option value="receber">A receber</option>
            </select>
            <input
              className="clonar-input"
              placeholder="Descrição"
              value={form.descricao}
              onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
            />
            <input
              className="clonar-input"
              placeholder="Categoria (opcional)"
              list="contas-categorias-sugeridas"
              value={form.categoria}
              onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}
            />
            <datalist id="contas-categorias-sugeridas">
              {CATEGORIAS_SUGERIDAS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <input
              className="clonar-input"
              inputMode="decimal"
              placeholder="Valor"
              value={form.valor}
              onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))}
            />
            <input
              type="date"
              className="dashboard-select"
              value={form.vencimento}
              onChange={(e) => setForm((f) => ({ ...f, vencimento: e.target.value }))}
            />
          </div>
          <textarea
            className="clonar-input"
            placeholder="Observação (opcional)"
            value={form.observacao}
            onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))}
            rows={2}
            style={{ width: "100%", marginTop: 8, resize: "vertical" }}
          />
          <div style={{ marginTop: 10 }}>
            <button type="button" className="btn-responder" disabled={salvando} onClick={salvar}>
              {salvando ? "Salvando..." : editandoId !== null ? "Salvar alterações" : "Criar lançamento"}
            </button>
          </div>
        </div>
      )}

      {resumo && (
        <div className="financeiro-cards-cor">
          <div className="financeiro-card-cor financeiro-card-vermelho">
            <div className="financeiro-card-cor-topo">
              <span>A pagar em aberto</span>
            </div>
            <div className="financeiro-card-cor-corpo">
              <span className="financeiro-card-cor-valor">{formatCurrency(resumo.emAbertoPagar)}</span>
              <div className="financeiro-card-cor-linha">
                <span>Atrasado</span>
                <b>{formatCurrency(resumo.atrasadoPagar)}</b>
              </div>
            </div>
          </div>
          <div className="financeiro-card-cor financeiro-card-azul">
            <div className="financeiro-card-cor-topo">
              <span>A receber em aberto</span>
            </div>
            <div className="financeiro-card-cor-corpo">
              <span className="financeiro-card-cor-valor">{formatCurrency(resumo.emAbertoReceber)}</span>
              <div className="financeiro-card-cor-linha">
                <span>Atrasado</span>
                <b>{formatCurrency(resumo.atrasadoReceber)}</b>
              </div>
            </div>
          </div>
          <div className="financeiro-card-cor financeiro-card-verde">
            <div className="financeiro-card-cor-topo">
              <span>Saldo do período (pago x recebido)</span>
            </div>
            <div className="financeiro-card-cor-corpo">
              <span className={`financeiro-card-cor-valor ${resumo.saldoPeriodo < 0 ? "financeiro-margem-negativa" : ""}`}>
                {formatCurrency(resumo.saldoPeriodo)}
              </span>
              <div className="financeiro-card-cor-linha">
                <span>Pago</span>
                <b>{formatCurrency(resumo.pagoPeriodo)}</b>
              </div>
              <div className="financeiro-card-cor-linha">
                <span>Recebido</span>
                <b>{formatCurrency(resumo.recebidoPeriodo)}</b>
              </div>
            </div>
          </div>
        </div>
      )}

      {erroLista && <div className="state-message state-error">{erroLista}</div>}
      {!erroLista && lancamentos === null && <div className="state-message">Carregando lançamentos...</div>}

      {lancamentos !== null && listaExibida.length === 0 && (
        <div className="state-message">Nenhum lançamento encontrado com esse filtro.</div>
      )}

      {listaExibida.length > 0 && (
        <div className="financeiro-tabela-wrap">
          <table className="financeiro-tabela">
            <thead>
              <tr>
                <th>Loja</th>
                <th>Tipo</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>Vencimento</th>
                <th className="financeiro-th-numero">Valor</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {listaExibida.map((l) => (
                <tr key={l.id}>
                  <td>{l.lojaNome}</td>
                  <td>{l.tipo === "pagar" ? "A pagar" : "A receber"}</td>
                  <td className="financeiro-td-titulo" title={l.descricao}>
                    {l.descricao}
                  </td>
                  <td className="financeiro-td-mudo">{l.categoria ?? "—"}</td>
                  <td>{formatDataCurta(l.vencimento)}</td>
                  <td className="financeiro-th-numero">{formatCurrency(l.valor)}</td>
                  <td className={classeStatus(l)}>{labelStatus(l)}</td>
                  <td className="financeiro-acoes">
                    {l.status === "pendente" && (
                      <button type="button" className="btn-responder" onClick={() => marcarPago(l.id)}>
                        Marcar pago
                      </button>
                    )}
                    <button type="button" className="btn-responder" onClick={() => abrirEdicao(l)}>
                      Editar
                    </button>
                    <button
                      type="button"
                      className="btn-excluir"
                      disabled={excluindoId === l.id}
                      onClick={() => excluir(l.id)}
                    >
                      {excluindoId === l.id ? "..." : "Excluir"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
