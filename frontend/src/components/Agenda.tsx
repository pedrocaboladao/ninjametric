import { useCallback, useEffect, useState } from "react";
import type { SemanaAgenda, DiaSemanaAgenda, TarefaAgenda, UsuarioParaAtribuir, LojaParaAgenda, NovaTarefaAgenda } from "../types/agenda";
import {
  fetchSemanaAtual,
  fetchTarefasAgenda,
  fetchUsuariosParaAtribuir,
  fetchLojasParaAgenda,
  criarTarefaAgenda,
  atualizarTarefaAgenda,
  excluirTarefaAgenda,
  marcarOcorrencia,
  desmarcarOcorrencia,
} from "../api/agenda";
import { AgendaTarefaModal } from "./AgendaTarefaModal";
import { IconPlus } from "./icons";

interface Props {
  onOcorrenciaAlterada: () => void;
}

const NOMES_DIA_SEMANA = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

// "YYYY-MM-DD" -> "DD/MM" — manipulação de string pura, sem passar por Date
// (evita qualquer risco de fuso horário pra uma data que já é só calendário).
function formatDataCurta(data: string): string {
  const [, m, d] = data.split("-");
  return `${d}/${m}`;
}

// Nome de exibição pra tag da semana — só encurta "Catedral Impermeabilizantes"
// (a única das 4 lojas com nome longo o bastante pra quebrar linha na tag).
// Não mexe no nome real da loja (usado em todo o resto do painel), só como
// aparece nesse selo pequeno.
function nomeCurtoDaLoja(nome: string): string {
  return nome === "Catedral Impermeabilizantes" ? "Catedral" : nome;
}

// % de tarefas de HOJE já marcadas como feitas — reseta sozinho todo dia,
// porque conta só as ocorrências do dia atual (não acumula atraso de dias
// anteriores, isso é visível em cada card via o selo "Atrasada").
function TermometroDiario({ dia }: { dia: DiaSemanaAgenda | undefined }) {
  const total = dia?.ocorrencias.length ?? 0;
  if (total === 0) {
    return <p className="agenda-dia-vazio">Nenhuma tarefa prevista pra hoje.</p>;
  }
  const feitas = dia!.ocorrencias.filter((o) => o.concluido).length;
  const percentual = Math.round((feitas / total) * 100);
  return (
    <div className="discrepancia-termometro">
      <div className="discrepancia-termometro-topo">
        <span>Progresso de hoje</span>
        <span>
          <b>{feitas}</b> de <b>{total}</b> tarefas · {percentual}%
        </span>
      </div>
      <div className="financeiro-equilibrio-barra">
        <div
          className={`financeiro-equilibrio-barra-preenchida ${percentual === 100 ? "financeiro-equilibrio-barra-ok" : ""}`}
          style={{ width: `${percentual}%` }}
        />
      </div>
    </div>
  );
}

export function Agenda({ onOcorrenciaAlterada }: Props) {
  const [aba, setAba] = useState<"semana" | "gerenciar">("semana");
  const [semana, setSemana] = useState<SemanaAgenda | null>(null);
  const [tarefas, setTarefas] = useState<TarefaAgenda[] | null>(null);
  const [usuarios, setUsuarios] = useState<UsuarioParaAtribuir[]>([]);
  const [lojas, setLojas] = useState<LojaParaAgenda[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [tarefaEditando, setTarefaEditando] = useState<TarefaAgenda | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroModal, setErroModal] = useState<string | null>(null);

  const carregarSemana = useCallback(async () => {
    try {
      setSemana(await fetchSemanaAtual());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao carregar a semana.");
    }
  }, []);

  const carregarTarefas = useCallback(async () => {
    try {
      setTarefas(await fetchTarefasAgenda());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao carregar tarefas.");
    }
  }, []);

  useEffect(() => {
    carregarSemana();
    fetchUsuariosParaAtribuir()
      .then(setUsuarios)
      .catch(() => {});
    fetchLojasParaAgenda()
      .then(setLojas)
      .catch(() => {});
  }, [carregarSemana]);

  useEffect(() => {
    if (aba === "gerenciar" && tarefas === null) carregarTarefas();
  }, [aba, tarefas, carregarTarefas]);

  async function alternarOcorrencia(tarefaId: number, data: string, concluido: boolean) {
    try {
      if (concluido) {
        await desmarcarOcorrencia(tarefaId, data);
      } else {
        await marcarOcorrencia(tarefaId, data);
      }
      await carregarSemana();
      onOcorrenciaAlterada();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao atualizar ocorrência.");
    }
  }

  function abrirNova() {
    setTarefaEditando(null);
    setErroModal(null);
    setModalAberto(true);
  }

  function abrirEdicao(tarefa: TarefaAgenda) {
    setTarefaEditando(tarefa);
    setErroModal(null);
    setModalAberto(true);
  }

  async function salvar(dados: NovaTarefaAgenda) {
    setSalvando(true);
    setErroModal(null);
    try {
      if (tarefaEditando) {
        await atualizarTarefaAgenda(tarefaEditando.id, dados);
      } else {
        await criarTarefaAgenda(dados);
      }
      setModalAberto(false);
      await Promise.all([carregarSemana(), carregarTarefas()]);
      onOcorrenciaAlterada();
    } catch (err) {
      setErroModal(err instanceof Error ? err.message : "Falha ao salvar tarefa.");
    } finally {
      setSalvando(false);
    }
  }

  async function pausarOuAtivar(tarefa: TarefaAgenda) {
    try {
      await atualizarTarefaAgenda(tarefa.id, { ativo: !tarefa.ativo });
      await Promise.all([carregarSemana(), carregarTarefas()]);
      onOcorrenciaAlterada();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao atualizar tarefa.");
    }
  }

  async function excluir(tarefa: TarefaAgenda) {
    if (!window.confirm(`Excluir "${tarefa.titulo}"? Isso também apaga o histórico de conclusões dela.`)) return;
    try {
      await excluirTarefaAgenda(tarefa.id);
      await Promise.all([carregarSemana(), carregarTarefas()]);
      onOcorrenciaAlterada();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao excluir tarefa.");
    }
  }

  // Duplica a tarefa (mesmo título/intervalo/início/responsável) só trocando
  // a loja — pra repetir a mesma rotina em outra loja sem preencher tudo de
  // novo. Reaproveita o mesmo POST de criar, não precisa de rota nova.
  async function clonarPara(tarefa: TarefaAgenda, lojaId: number) {
    try {
      await criarTarefaAgenda({
        titulo: tarefa.titulo,
        descricao: tarefa.descricao,
        intervaloDias: tarefa.intervaloDias,
        dataInicio: tarefa.dataInicio,
        atribuidoAUsuarioId: tarefa.atribuidoAUsuarioId,
        lojaId,
      });
      await Promise.all([carregarSemana(), carregarTarefas()]);
      onOcorrenciaAlterada();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao clonar tarefa.");
    }
  }

  return (
    <div className="agenda-page">
      <div className="tarefas-topo">
        <span className="painel-eyebrow">Agenda</span>
        <h1>Tarefas recorrentes</h1>
        <p className="painel-sub">Atividades essenciais que se repetem de tempos em tempos — a semana atual, sempre em dia.</p>
      </div>

      <div className="tarefas-abas-linha">
        <div className="tarefas-abas">
          <button className={`tarefas-aba ${aba === "semana" ? "tarefas-aba-ativa" : ""}`} onClick={() => setAba("semana")}>
            Semana
          </button>
          <button className={`tarefas-aba ${aba === "gerenciar" ? "tarefas-aba-ativa" : ""}`} onClick={() => setAba("gerenciar")}>
            Gerenciar tarefas
          </button>
        </div>
        {aba === "gerenciar" && (
          <button type="button" className="btn-responder" onClick={abrirNova}>
            <IconPlus size={14} /> Nova tarefa
          </button>
        )}
      </div>

      {erro && <div className="clonar-erro">{erro}</div>}

      {aba === "semana" && (
        <>
          {!semana && !erro && <div className="state-message">Carregando semana...</div>}
          {semana && <TermometroDiario dia={semana.dias.find((d) => d.data === semana.hoje)} />}
          {semana && (
            <div className="agenda-semana-grade">
              {semana.dias.map((dia, indice) => {
                const ehHoje = dia.data === semana.hoje;
                return (
                  <div key={dia.data} className={`agenda-dia-card ${ehHoje ? "agenda-dia-card-hoje" : ""}`}>
                    <div className="agenda-dia-cabecalho">
                      <span>{NOMES_DIA_SEMANA[indice]}</span>
                      <span className="financeiro-td-mudo">{formatDataCurta(dia.data)}</span>
                    </div>
                    {dia.ocorrencias.length === 0 && <p className="agenda-dia-vazio">Sem tarefas.</p>}
                    {dia.ocorrencias.map((oc) => (
                      <button
                        key={oc.tarefaId}
                        type="button"
                        className={`agenda-ocorrencia ${oc.concluido ? "agenda-ocorrencia-feita" : ""} ${
                          oc.atrasado ? "agenda-ocorrencia-atrasada" : ""
                        }`}
                        onClick={() => alternarOcorrencia(oc.tarefaId, dia.data, oc.concluido)}
                      >
                        <span className="agenda-ocorrencia-titulo">{oc.titulo}</span>
                        <span className="financeiro-td-mudo">{oc.atribuidoANome ?? "Qualquer um"}</span>
                        <div className="agenda-ocorrencia-tags">
                          {oc.lojaNome && <span className="agenda-loja-tag">{nomeCurtoDaLoja(oc.lojaNome)}</span>}
                          {oc.atrasado && <span className="sidebar-badge">Atrasada</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {aba === "gerenciar" && (
        <div className="financeiro-tabela-wrap">
          <table className="financeiro-tabela">
            <thead>
              <tr>
                <th>Título</th>
                <th>Intervalo</th>
                <th>Início</th>
                <th>Responsável</th>
                <th>Loja</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {tarefas === null && (
                <tr>
                  <td colSpan={7} className="state-message">
                    Carregando...
                  </td>
                </tr>
              )}
              {tarefas?.length === 0 && (
                <tr>
                  <td colSpan={7} className="state-message">
                    Nenhuma tarefa cadastrada ainda.
                  </td>
                </tr>
              )}
              {tarefas?.map((t) => (
                <tr key={t.id}>
                  <td>
                    <span className="financeiro-td-titulo">{t.titulo}</span>
                    {t.descricao && <div className="financeiro-td-mudo">{t.descricao}</div>}
                  </td>
                  <td>A cada {t.intervaloDias} dia{t.intervaloDias > 1 ? "s" : ""}</td>
                  <td>{formatDataCurta(t.dataInicio)}</td>
                  <td>{t.atribuidoANome ?? "Qualquer um"}</td>
                  <td>{t.lojaNome ?? "—"}</td>
                  <td>{t.ativo ? "Ativa" : "Pausada"}</td>
                  <td>
                    <div className="tarefa-novo-cartao-acoes">
                      <button type="button" className="btn-responder" onClick={() => abrirEdicao(t)}>
                        Editar
                      </button>
                      <button type="button" className="btn-responder" onClick={() => pausarOuAtivar(t)}>
                        {t.ativo ? "Pausar" : "Ativar"}
                      </button>
                      <button type="button" className="btn-excluir" onClick={() => excluir(t)}>
                        Excluir
                      </button>
                      <select
                        className="clonar-input agenda-clonar-select"
                        value=""
                        onChange={(e) => {
                          if (e.target.value) clonarPara(t, Number(e.target.value));
                        }}
                      >
                        <option value="">Clonar para...</option>
                        {lojas.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.nome}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalAberto && (
        <AgendaTarefaModal
          tarefa={tarefaEditando}
          usuarios={usuarios}
          lojas={lojas}
          salvando={salvando}
          erro={erroModal}
          onSalvar={salvar}
          onFechar={() => setModalAberto(false)}
        />
      )}
    </div>
  );
}
