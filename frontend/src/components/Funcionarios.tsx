import { useEffect, useState } from "react";
import {
  fetchEmpacotadores,
  criarEmpacotador,
  atualizarEmpacotador,
  excluirEmpacotador,
  fetchLancamentosDoDia,
  salvarLancamentos,
  fetchRankingMensal,
  fetchHistoricoEmpacotador,
  fetchResumoBonus,
  fetchDetalheBonus,
  registrarPagamentoAvulso,
  fecharBonusEmLote,
  fetchFechamentos,
} from "../api/empacotadores";
import type {
  Empacotador,
  ItemRanking,
  HistoricoDia,
  ResumoBonus,
  DetalheDiaBonus,
  Fechamento,
} from "../types/empacotadores";
import { formatCurrency } from "../utils/format";
import { IconCrown, IconWreath, IconPlus, IconTrash } from "./icons";

const MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function numeroFormatado(n: number): string {
  return String(n).padStart(2, "0");
}

function opcoesDeMeses(): { ano: number; mes: number }[] {
  const hoje = new Date();
  const opcoes = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    opcoes.push({ ano: d.getFullYear(), mes: d.getMonth() + 1 });
  }
  return opcoes;
}

export function Funcionarios() {
  const hoje = new Date();
  const [aba, setAba] = useState<"ranking" | "lancar" | "gerenciar" | "bonus">("ranking");
  const [empacotadores, setEmpacotadores] = useState<Empacotador[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [ranking, setRanking] = useState<ItemRanking[] | null>(null);
  const [funcionarioFiltro, setFuncionarioFiltro] = useState<number | "">("");
  const [funcionarioSelecionado, setFuncionarioSelecionado] = useState<number | "">("");
  const [historico, setHistorico] = useState<HistoricoDia[] | null>(null);

  const [dataLancamento, setDataLancamento] = useState(hojeISO());
  const [valoresForm, setValoresForm] = useState<Record<number, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);

  const [novoNumero, setNovoNumero] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [novaMeta, setNovaMeta] = useState("");
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [editNumero, setEditNumero] = useState("");
  const [editNome, setEditNome] = useState("");
  const [editMeta, setEditMeta] = useState("");
  const [confirmandoExcluir, setConfirmandoExcluir] = useState<number | null>(null);

  const [resumoBonus, setResumoBonus] = useState<ResumoBonus[] | null>(null);
  const [fechamentos, setFechamentos] = useState<Fechamento[] | null>(null);
  const [detalheAbertoId, setDetalheAbertoId] = useState<number | null>(null);
  const [detalheDias, setDetalheDias] = useState<DetalheDiaBonus[] | null>(null);
  const [avulsoAbertoId, setAvulsoAbertoId] = useState<number | null>(null);
  const [avulsoValor, setAvulsoValor] = useState("");
  const [confirmandoFechamento, setConfirmandoFechamento] = useState(false);
  const [fechando, setFechando] = useState(false);

  useEffect(() => {
    carregarEmpacotadores();
  }, []);

  useEffect(() => {
    carregarRanking();
  }, [ano, mes]);

  useEffect(() => {
    if (aba === "lancar") carregarLancamentos();
  }, [aba, dataLancamento]);

  useEffect(() => {
    if (aba === "bonus") {
      carregarResumoBonus();
      carregarFechamentos();
    }
  }, [aba]);

  async function carregarEmpacotadores() {
    try {
      setEmpacotadores(await fetchEmpacotadores());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao carregar empacotadores.");
    }
  }

  async function carregarRanking() {
    try {
      setRanking(await fetchRankingMensal(ano, mes));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao carregar ranking.");
    }
  }

  async function carregarLancamentos() {
    try {
      const dados = await fetchLancamentosDoDia(dataLancamento);
      const valores: Record<number, string> = {};
      dados.forEach((l) => {
        valores[l.empacotadorId] = String(l.pacotes);
      });
      setValoresForm(valores);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao carregar lançamentos.");
    }
  }

  async function handleFiltrar() {
    setFuncionarioSelecionado(funcionarioFiltro);
    if (funcionarioFiltro === "") {
      setHistorico(null);
      return;
    }
    try {
      setHistorico(await fetchHistoricoEmpacotador(Number(funcionarioFiltro), ano, mes));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao carregar histórico.");
    }
  }

  async function handleSalvarLancamentos(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setSalvo(false);
    try {
      const itens = Object.entries(valoresForm).map(([empacotadorId, pacotes]) => ({
        empacotadorId: Number(empacotadorId),
        pacotes: Number(pacotes) || 0,
      }));
      await salvarLancamentos(dataLancamento, itens);
      setSalvo(true);
      carregarRanking();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao salvar lançamentos.");
    } finally {
      setSalvando(false);
    }
  }

  async function handleCriarEmpacotador(e: React.FormEvent) {
    e.preventDefault();
    if (!novoNumero.trim() || !novoNome.trim()) return;
    try {
      const criado = await criarEmpacotador(Number(novoNumero), novoNome.trim());
      if (novaMeta.trim()) {
        await atualizarEmpacotador(criado.id, { metaDiaria: Number(novaMeta) });
      }
      setNovoNumero("");
      setNovoNome("");
      setNovaMeta("");
      carregarEmpacotadores();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao criar empacotador.");
    }
  }

  function iniciarEdicao(emp: Empacotador) {
    setEditandoId(emp.id);
    setEditNumero(String(emp.numero));
    setEditNome(emp.nome);
    setEditMeta(emp.metaDiaria !== null ? String(emp.metaDiaria) : "");
  }

  async function confirmarEdicao(id: number) {
    try {
      await atualizarEmpacotador(id, {
        numero: Number(editNumero),
        nome: editNome.trim(),
        metaDiaria: editMeta.trim() ? Number(editMeta) : null,
      });
      setEditandoId(null);
      carregarEmpacotadores();
      carregarRanking();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao atualizar empacotador.");
    }
  }

  async function handleExcluirEmpacotador(id: number) {
    try {
      await excluirEmpacotador(id);
      setConfirmandoExcluir(null);
      carregarEmpacotadores();
      carregarRanking();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao excluir empacotador.");
    }
  }

  async function carregarResumoBonus() {
    try {
      setResumoBonus(await fetchResumoBonus());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao carregar resumo de bônus.");
    }
  }

  async function carregarFechamentos() {
    try {
      setFechamentos(await fetchFechamentos());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao carregar fechamentos.");
    }
  }

  async function toggleDetalhe(empacotadorId: number) {
    if (detalheAbertoId === empacotadorId) {
      setDetalheAbertoId(null);
      setDetalheDias(null);
      return;
    }
    setDetalheAbertoId(empacotadorId);
    setDetalheDias(null);
    try {
      setDetalheDias(await fetchDetalheBonus(empacotadorId));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao carregar detalhe.");
    }
  }

  async function handlePagarAvulso(empacotadorId: number) {
    const valor = Number(avulsoValor);
    if (!(valor > 0)) return;
    try {
      await registrarPagamentoAvulso(empacotadorId, valor);
      setAvulsoAbertoId(null);
      setAvulsoValor("");
      carregarResumoBonus();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao registrar pagamento.");
    }
  }

  async function handleFecharBonus() {
    setFechando(true);
    try {
      await fecharBonusEmLote();
      setConfirmandoFechamento(false);
      carregarResumoBonus();
      carregarFechamentos();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao fechar bônus.");
    } finally {
      setFechando(false);
    }
  }

  const top3 = ranking?.slice(0, 3) ?? [];
  const resto = ranking?.slice(3) ?? [];
  const maiorValor = ranking?.[0]?.totalPacotes || 1;
  const [primeiro, segundo, terceiro] = top3;

  return (
    <div className="func">
      <div className="func-topo">
        <span className="painel-eyebrow">Operação</span>
        <h1>Funcionários</h1>
        <p className="painel-sub">Acompanhe a produtividade e o desempenho dos empacotadores.</p>
        <span className="func-badge">
          <i className="func-badge-dot" /> Arena dos Empacotadores · {MESES[mes - 1]} de {ano}
        </span>
      </div>

      <div className="tarefas-abas">
        <button
          className={`tarefas-aba ${aba === "ranking" ? "tarefas-aba-ativa" : ""}`}
          onClick={() => setAba("ranking")}
        >
          Ranking
        </button>
        <button
          className={`tarefas-aba ${aba === "lancar" ? "tarefas-aba-ativa" : ""}`}
          onClick={() => setAba("lancar")}
        >
          Lançar pacotes
        </button>
        <button
          className={`tarefas-aba ${aba === "gerenciar" ? "tarefas-aba-ativa" : ""}`}
          onClick={() => setAba("gerenciar")}
        >
          Gerenciar equipe
        </button>
        <button
          className={`tarefas-aba ${aba === "bonus" ? "tarefas-aba-ativa" : ""}`}
          onClick={() => setAba("bonus")}
        >
          Bônus
        </button>
      </div>

      {erro && <div className="clonar-erro">{erro}</div>}

      {aba === "ranking" && (
        <>
          <div className="func-filtro-linha">
            <div className="func-filtro-box">
              <div className="func-filtro-campo">
                <label>Funcionário</label>
                <select
                  className="clonar-input"
                  value={funcionarioFiltro}
                  onChange={(e) => setFuncionarioFiltro(e.target.value ? Number(e.target.value) : "")}
                >
                  <option value="">Selecione</option>
                  {empacotadores.map((e) => (
                    <option key={e.id} value={e.id}>
                      {numeroFormatado(e.numero)} - {e.nome.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn-responder" onClick={handleFiltrar} type="button">
                Filtrar
              </button>
            </div>

            <div className="func-mes-campo">
              <label>Mês</label>
              <select
                className="clonar-input"
                value={`${ano}-${mes}`}
                onChange={(e) => {
                  const [a, m] = e.target.value.split("-").map(Number);
                  setAno(a);
                  setMes(m);
                }}
              >
                {opcoesDeMeses().map((o) => (
                  <option key={`${o.ano}-${o.mes}`} value={`${o.ano}-${o.mes}`}>
                    {MESES[o.mes - 1]} de {o.ano}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!ranking && <div className="state-message">Carregando ranking...</div>}

          {ranking && ranking.length === 0 && (
            <div className="state-message">
              Nenhum empacotador cadastrado ainda. Vá em "Gerenciar equipe" para adicionar.
            </div>
          )}

          {ranking && ranking.length > 0 && (
            <>
              <span className="painel-eyebrow func-secao-titulo">Top 3</span>
              <div className="func-podio">
                {segundo && <PodioCard item={segundo} posicao={2} />}
                {primeiro && <PodioCard item={primeiro} posicao={1} />}
                {terceiro && <PodioCard item={terceiro} posicao={3} />}
              </div>

              {resto.length > 0 && (
                <>
                  <span className="painel-eyebrow func-secao-titulo">Ranking — 4º em diante</span>
                  <div className="func-ranking-lista">
                    {resto.map((item, i) => (
                      <div key={item.id} className="func-ranking-item">
                        <span className="func-ranking-posicao">{i + 4}</span>
                        <div className="func-ranking-info">
                          <div className="func-ranking-nome">
                            {numeroFormatado(item.numero)} - {item.nome.toUpperCase()}
                          </div>
                          <div className="func-ranking-barra-track">
                            <div
                              className="func-ranking-barra-fill"
                              style={{ width: `${(item.totalPacotes / maiorValor) * 100}%` }}
                            />
                          </div>
                        </div>
                        <div className="func-ranking-valores">
                          <div className="func-ranking-valor">{item.totalPacotes}</div>
                          <div className="func-ranking-label">pacotes</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {funcionarioSelecionado !== "" && historico && (
                <div className="painel func-historico">
                  <span className="painel-eyebrow">Detalhe do funcionário</span>
                  <h2>
                    {(() => {
                      const emp = empacotadores.find((e) => e.id === funcionarioSelecionado);
                      return emp ? `${numeroFormatado(emp.numero)} - ${emp.nome}` : "";
                    })()}
                  </h2>
                  {historico.length === 0 ? (
                    <p className="painel-sub">Nenhum lançamento neste mês.</p>
                  ) : (
                    <div className="func-historico-lista">
                      {historico.map((h) => (
                        <div key={h.data} className="func-historico-item">
                          <span>{new Date(`${h.data}T00:00:00`).toLocaleDateString("pt-BR")}</span>
                          <span>{h.pacotes} pacotes</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {aba === "lancar" && (
        <div className="func-lancar">
          <div className="func-lancar-topo">
            <label>Data</label>
            <input
              type="date"
              className="clonar-input func-lancar-data"
              value={dataLancamento}
              onChange={(e) => setDataLancamento(e.target.value)}
            />
          </div>

          {empacotadores.length === 0 && (
            <div className="state-message">Cadastre empacotadores em "Gerenciar equipe" antes de lançar pacotes.</div>
          )}

          {empacotadores.length > 0 && (
            <form onSubmit={handleSalvarLancamentos}>
              <div className="func-lancar-lista">
                {empacotadores.map((emp) => (
                  <div key={emp.id} className="func-lancar-item">
                    <span className="func-lancar-nome">
                      {numeroFormatado(emp.numero)} - {emp.nome.toUpperCase()}
                    </span>
                    <input
                      type="number"
                      min={0}
                      className="clonar-input func-lancar-input"
                      value={valoresForm[emp.id] ?? ""}
                      onChange={(e) => setValoresForm((v) => ({ ...v, [emp.id]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <div className="func-lancar-acoes">
                <button type="submit" className="btn-responder" disabled={salvando}>
                  {salvando ? "Salvando..." : "Salvar lançamentos"}
                </button>
                {salvo && <span className="func-lancar-salvo">Salvo!</span>}
              </div>
            </form>
          )}
        </div>
      )}

      {aba === "gerenciar" && (
        <div className="func-gerenciar">
          <form className="func-gerenciar-novo" onSubmit={handleCriarEmpacotador}>
            <input
              className="clonar-input func-gerenciar-input-numero"
              placeholder="Nº"
              value={novoNumero}
              onChange={(e) => setNovoNumero(e.target.value)}
            />
            <input
              className="clonar-input"
              placeholder="Nome do empacotador"
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
            />
            <input
              type="number"
              min={0}
              className="clonar-input func-gerenciar-input-meta"
              placeholder="Meta/dia"
              value={novaMeta}
              onChange={(e) => setNovaMeta(e.target.value)}
            />
            <button type="submit" className="btn-responder">
              <IconPlus size={15} /> Adicionar
            </button>
          </form>

          <div className="func-gerenciar-lista">
            {empacotadores.map((emp) => (
              <div key={emp.id} className="func-gerenciar-item">
                {editandoId === emp.id ? (
                  <>
                    <input
                      className="clonar-input func-gerenciar-input-numero"
                      value={editNumero}
                      onChange={(e) => setEditNumero(e.target.value)}
                    />
                    <input className="clonar-input" value={editNome} onChange={(e) => setEditNome(e.target.value)} />
                    <input
                      type="number"
                      min={0}
                      className="clonar-input func-gerenciar-input-meta"
                      placeholder="Meta/dia"
                      value={editMeta}
                      onChange={(e) => setEditMeta(e.target.value)}
                    />
                    <button className="btn-responder" onClick={() => confirmarEdicao(emp.id)} type="button">
                      Salvar
                    </button>
                    <button className="btn-excluir" onClick={() => setEditandoId(null)} type="button">
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <span className="func-gerenciar-numero">{numeroFormatado(emp.numero)}</span>
                    <span className="func-gerenciar-nome">{emp.nome}</span>
                    <span className="func-gerenciar-meta">
                      {emp.metaDiaria !== null ? `Meta: ${emp.metaDiaria}/dia` : "Sem meta"}
                    </span>
                    <button className="btn-excluir" onClick={() => iniciarEdicao(emp)} type="button">
                      Editar
                    </button>
                    {confirmandoExcluir === emp.id ? (
                      <>
                        <button
                          className="btn-excluir"
                          onClick={() => handleExcluirEmpacotador(emp.id)}
                          type="button"
                        >
                          Confirmar exclusão
                        </button>
                        <button className="btn-excluir" onClick={() => setConfirmandoExcluir(null)} type="button">
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn-excluir"
                        onClick={() => setConfirmandoExcluir(emp.id)}
                        title="Excluir"
                        type="button"
                      >
                        <IconTrash size={14} />
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
            {empacotadores.length === 0 && <div className="state-message">Nenhum empacotador cadastrado ainda.</div>}
          </div>
        </div>
      )}

      {aba === "bonus" && (
        <div className="func-bonus">
          <div className="func-bonus-topo">
            <p className="painel-sub">
              Bônus de R$ 0,50 por pacote acima da meta diária, apurado dia a dia. Configure a meta em "Gerenciar
              equipe".
            </p>
            {confirmandoFechamento ? (
              <div className="func-bonus-confirmar">
                <span>Fechar o bônus pendente de todo mundo?</span>
                <button className="btn-responder" type="button" onClick={handleFecharBonus} disabled={fechando}>
                  {fechando ? "Fechando..." : "Confirmar"}
                </button>
                <button className="btn-excluir" type="button" onClick={() => setConfirmandoFechamento(false)}>
                  Cancelar
                </button>
              </div>
            ) : (
              <button className="btn-responder" type="button" onClick={() => setConfirmandoFechamento(true)}>
                Fechar bônus em lote
              </button>
            )}
          </div>

          {!resumoBonus && <div className="state-message">Carregando resumo de bônus...</div>}

          {resumoBonus && resumoBonus.length === 0 && (
            <div className="state-message">Nenhum empacotador cadastrado ainda.</div>
          )}

          {resumoBonus && resumoBonus.length > 0 && (
            <div className="func-bonus-lista">
              {resumoBonus.map((r) => (
                <div key={r.empacotadorId} className="painel func-bonus-item">
                  <div className="func-bonus-item-topo">
                    <div>
                      <div className="func-bonus-nome">
                        {numeroFormatado(r.numero)} - {r.nome.toUpperCase()}
                      </div>
                      <div className="func-bonus-meta">
                        {r.metaDiaria !== null ? `Meta: ${r.metaDiaria} pacotes/dia` : "Sem meta definida"}
                      </div>
                    </div>
                    <button className="btn-excluir" type="button" onClick={() => toggleDetalhe(r.empacotadorId)}>
                      {detalheAbertoId === r.empacotadorId ? "Fechar detalhe" : "Ver detalhe"}
                    </button>
                  </div>

                  <div className="func-bonus-valores">
                    <div className="func-bonus-valor-item">
                      <span className="func-bonus-valor-label">Gerado</span>
                      <span className="func-bonus-valor-numero">{formatCurrency(r.bonusGerado)}</span>
                    </div>
                    <div className="func-bonus-valor-item">
                      <span className="func-bonus-valor-label">Pago</span>
                      <span className="func-bonus-valor-numero func-bonus-valor-pago">
                        {formatCurrency(r.bonusPago)}
                      </span>
                    </div>
                    <div className="func-bonus-valor-item">
                      <span className="func-bonus-valor-label">Pendente</span>
                      <span className="func-bonus-valor-numero func-bonus-valor-pendente">
                        {formatCurrency(r.bonusPendente)}
                      </span>
                    </div>
                  </div>

                  {r.bonusPendente > 0 &&
                    (avulsoAbertoId === r.empacotadorId ? (
                      <div className="func-bonus-avulso-form">
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          className="clonar-input"
                          value={avulsoValor}
                          onChange={(e) => setAvulsoValor(e.target.value)}
                        />
                        <button
                          className="btn-responder"
                          type="button"
                          onClick={() => handlePagarAvulso(r.empacotadorId)}
                        >
                          Confirmar
                        </button>
                        <button className="btn-excluir" type="button" onClick={() => setAvulsoAbertoId(null)}>
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn-excluir func-bonus-avulso-btn"
                        type="button"
                        onClick={() => {
                          setAvulsoAbertoId(r.empacotadorId);
                          setAvulsoValor(r.bonusPendente.toFixed(2));
                        }}
                      >
                        Pagamento avulso
                      </button>
                    ))}

                  {detalheAbertoId === r.empacotadorId && (
                    <div className="func-bonus-detalhe">
                      {!detalheDias && <div className="state-message">Carregando detalhe...</div>}
                      {detalheDias && detalheDias.filter((d) => d.excedente > 0).length === 0 && (
                        <p className="painel-sub">Nenhum dia com excedente ainda.</p>
                      )}
                      {detalheDias && detalheDias.filter((d) => d.excedente > 0).length > 0 && (
                        <div className="func-bonus-detalhe-lista">
                          {detalheDias
                            .filter((d) => d.excedente > 0)
                            .map((d) => (
                              <div key={d.data} className="func-bonus-detalhe-item">
                                <span>{new Date(`${d.data}T00:00:00`).toLocaleDateString("pt-BR")}</span>
                                <span>
                                  {d.pacotes} pacotes (meta {d.meta})
                                </span>
                                <span>+{d.excedente} excedente</span>
                                <span className="func-bonus-detalhe-valor">{formatCurrency(d.bonusDoDia)}</span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {fechamentos && fechamentos.length > 0 && (
            <>
              <span className="painel-eyebrow func-secao-titulo">Histórico de fechamentos</span>
              <div className="func-bonus-lista">
                {fechamentos.map((f) => (
                  <div key={f.id} className="painel func-bonus-item">
                    <div className="func-bonus-item-topo">
                      <span>{new Date(f.criadoEm).toLocaleString("pt-BR")}</span>
                      <span className="func-bonus-valor-numero">{formatCurrency(f.total)}</span>
                    </div>
                    <div className="func-bonus-detalhe-lista">
                      {f.itens.map((it) => (
                        <div key={it.empacotadorId} className="func-bonus-detalhe-item">
                          <span>
                            {numeroFormatado(it.numero)} - {it.nome}
                          </span>
                          <span className="func-bonus-detalhe-valor">{formatCurrency(it.valor)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PodioCard({ item, posicao }: { item: ItemRanking; posicao: 1 | 2 | 3 }) {
  return (
    <div className={`func-podio-card func-podio-card-${posicao}`}>
      <div className="func-podio-medalha">
        {posicao === 1 && (
          <div className="func-podio-coroa">
            <IconCrown size={22} />
          </div>
        )}
        <IconWreath size={posicao === 1 ? 74 : 60} dourado={posicao === 1} />
        <span className="func-podio-numero">{posicao}</span>
      </div>
      <div className="func-podio-nome">
        {numeroFormatado(item.numero)} - {item.nome.toUpperCase()}
      </div>
      <div className="func-podio-valor">{item.totalPacotes}</div>
      <div className="func-podio-label">pacotes</div>
    </div>
  );
}
