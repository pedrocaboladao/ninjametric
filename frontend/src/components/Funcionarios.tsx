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
} from "../api/empacotadores";
import type { Empacotador, ItemRanking, HistoricoDia } from "../types/empacotadores";
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
  const [aba, setAba] = useState<"ranking" | "lancar" | "gerenciar">("ranking");
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
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [editNumero, setEditNumero] = useState("");
  const [editNome, setEditNome] = useState("");
  const [confirmandoExcluir, setConfirmandoExcluir] = useState<number | null>(null);

  useEffect(() => {
    carregarEmpacotadores();
  }, []);

  useEffect(() => {
    carregarRanking();
  }, [ano, mes]);

  useEffect(() => {
    if (aba === "lancar") carregarLancamentos();
  }, [aba, dataLancamento]);

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
      await criarEmpacotador(Number(novoNumero), novoNome.trim());
      setNovoNumero("");
      setNovoNome("");
      carregarEmpacotadores();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao criar empacotador.");
    }
  }

  function iniciarEdicao(emp: Empacotador) {
    setEditandoId(emp.id);
    setEditNumero(String(emp.numero));
    setEditNome(emp.nome);
  }

  async function confirmarEdicao(id: number) {
    try {
      await atualizarEmpacotador(id, { numero: Number(editNumero), nome: editNome.trim() });
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
