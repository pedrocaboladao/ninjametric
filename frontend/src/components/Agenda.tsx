import { useCallback, useEffect, useState } from "react";
import type {
  SemanaAgenda,
  DiaSemanaAgenda,
  TarefaAgenda,
  UsuarioParaAtribuir,
  LojaParaAgenda,
  NovaTarefaAgenda,
  RelatorioAgenda,
} from "../types/agenda";
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
  fetchRelatoriosAgenda,
  criarRelatorioAgenda,
  excluirRelatorioAgenda,
} from "../api/agenda";
import { AgendaTarefaModal } from "./AgendaTarefaModal";
import { IconPlus, IconCheck, IconCalendar } from "./icons";
import { formatDataHora } from "../utils/format";

const REGEX_URL = /(https?:\/\/[^\s]+)/g;

// Quebra o texto livre em pedaços, virando link clicável qualquer trecho que
// pareça uma URL (é assim que o link do anúncio colado vira clicável sem
// precisar de um campo separado pra isso). split() com grupo de captura
// alterna [texto, url, texto, url, ...] — índice ímpar é sempre a URL
// capturada, por isso não precisa testar o regex de novo (regex global tem
// estado em .test/.exec, testar de novo aqui daria match errado a cada chamada).
function renderComLinks(texto: string) {
  return texto.split(REGEX_URL).map((parte, i) =>
    i % 2 === 1 ? (
      <a key={i} href={parte} target="_blank" rel="noopener noreferrer" className="agenda-relatorio-link">
        {parte}
      </a>
    ) : (
      <span key={i}>{parte}</span>
    )
  );
}

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

// Cor de urgência do aviso de expiração de promoção — sem campanha achada
// ou bem perto de vencer é o caso mais grave (vermelho), tempo confortável
// é verde, o meio-termo é laranja. Independe de feita/atrasada normal: o
// ponto desse tipo de tarefa é mostrar o prazo real, não só "fiz hoje?".
function corUrgenciaPromocao(diasRestantes: number | null): "verde" | "laranja" | "vermelho" {
  if (diasRestantes === null || diasRestantes < 3) return "vermelho";
  if (diasRestantes <= 7) return "laranja";
  return "verde";
}

function textoPromocao(nome: string | null, diasRestantes: number | null): string {
  if (diasRestantes === null) return "Nenhuma campanha própria ativa encontrada";
  if (diasRestantes < 0) return `${nome ?? "Campanha"} venceu há ${Math.abs(diasRestantes)} dia(s)`;
  if (diasRestantes === 0) return `${nome ?? "Campanha"} vence hoje`;
  return `${nome ?? "Campanha"} — faltam ${diasRestantes} dia(s)`;
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
  // Vermelho/azul/verde em vez do padrão vermelho-ou-verde da barra que essa
  // classe usa em Discrepâncias (lá é "desvio de preço", aqui é "progresso" —
  // 60% do dia não é um alarme, é só "ainda não terminou").
  const cor = percentual === 100 ? "var(--good-text)" : percentual >= 50 ? "var(--accent)" : "var(--critical-text)";
  return (
    <div className="discrepancia-termometro">
      <div className="discrepancia-termometro-topo">
        <span>Progresso de hoje</span>
        <span>
          <b>{feitas}</b> de <b>{total}</b> tarefas · {percentual}%
        </span>
      </div>
      <div className="financeiro-equilibrio-barra">
        <div className="financeiro-equilibrio-barra-preenchida" style={{ width: `${percentual}%`, background: cor }} />
      </div>
    </div>
  );
}

export function Agenda({ onOcorrenciaAlterada }: Props) {
  const [aba, setAba] = useState<"semana" | "gerenciar" | "relatorio">("semana");
  const [semana, setSemana] = useState<SemanaAgenda | null>(null);
  const [tarefas, setTarefas] = useState<TarefaAgenda[] | null>(null);
  const [usuarios, setUsuarios] = useState<UsuarioParaAtribuir[]>([]);
  const [lojas, setLojas] = useState<LojaParaAgenda[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [tarefaEditando, setTarefaEditando] = useState<TarefaAgenda | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroModal, setErroModal] = useState<string | null>(null);
  const [relatorios, setRelatorios] = useState<RelatorioAgenda[] | null>(null);
  const [novoRelatorio, setNovoRelatorio] = useState("");
  const [enviandoRelatorio, setEnviandoRelatorio] = useState(false);

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

  const carregarRelatorios = useCallback(async () => {
    try {
      setRelatorios(await fetchRelatoriosAgenda());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao carregar o relatório.");
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

  useEffect(() => {
    if (aba === "relatorio" && relatorios === null) carregarRelatorios();
  }, [aba, relatorios, carregarRelatorios]);

  async function enviarRelatorio() {
    if (!novoRelatorio.trim()) return;
    setEnviandoRelatorio(true);
    try {
      await criarRelatorioAgenda(novoRelatorio.trim());
      setNovoRelatorio("");
      await carregarRelatorios();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao adicionar ao relatório.");
    } finally {
      setEnviandoRelatorio(false);
    }
  }

  async function excluirEntradaRelatorio(id: number) {
    if (!window.confirm("Excluir essa entrada do relatório?")) return;
    try {
      await excluirRelatorioAgenda(id);
      await carregarRelatorios();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao excluir entrada do relatório.");
    }
  }

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
        expiraComPromocao: tarefa.expiraComPromocao,
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
        <h1>
          <span className="agenda-titulo-icone">
            <IconCalendar size={24} />
          </span>
          Tarefas recorrentes
        </h1>
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
          <button className={`tarefas-aba ${aba === "relatorio" ? "tarefas-aba-ativa" : ""}`} onClick={() => setAba("relatorio")}>
            Relatório
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
          {semana && (
            <div className="agenda-termometro-card">
              <TermometroDiario dia={semana.dias.find((d) => d.data === semana.hoje)} />
            </div>
          )}
          {semana && (
            <div className="agenda-semana-grade">
              {semana.dias.map((dia, indice) => {
                const ehHoje = dia.data === semana.hoje;
                const [, , diaNumero] = dia.data.split("-");
                return (
                  <div key={dia.data} className={`agenda-dia-card ${ehHoje ? "agenda-dia-card-hoje" : ""}`}>
                    <div className="agenda-dia-cabecalho">
                      <span className="agenda-dia-nome">{NOMES_DIA_SEMANA[indice].slice(0, 3)}</span>
                      <span className={`agenda-dia-numero ${ehHoje ? "agenda-dia-numero-hoje" : ""}`}>{diaNumero}</span>
                    </div>
                    <div className="agenda-dia-corpo">
                      {dia.ocorrencias.length === 0 && <p className="agenda-dia-vazio">Sem tarefas</p>}
                      {dia.ocorrencias.map((oc) => {
                        const urgencia = oc.expiraComPromocao ? corUrgenciaPromocao(oc.promocaoDiasRestantes) : null;
                        return (
                          <button
                            key={oc.tarefaId}
                            type="button"
                            className={`agenda-ocorrencia ${oc.concluido ? "agenda-ocorrencia-feita" : ""} ${
                              oc.atrasado ? "agenda-ocorrencia-atrasada" : ""
                            } ${urgencia ? `agenda-ocorrencia-urgencia-${urgencia}` : ""}`}
                            onClick={() => alternarOcorrencia(oc.tarefaId, dia.data, oc.concluido)}
                          >
                            <span className={`agenda-ocorrencia-check ${oc.concluido ? "agenda-ocorrencia-check-feita" : ""}`}>
                              {oc.concluido && <IconCheck size={11} />}
                            </span>
                            <span className="agenda-ocorrencia-conteudo">
                              <span className="agenda-ocorrencia-titulo">{oc.titulo}</span>
                              <span className="agenda-ocorrencia-meta">
                                <span>{oc.atribuidoANome ?? "Qualquer um"}</span>
                                {oc.lojaNome && <span className="agenda-loja-tag">{nomeCurtoDaLoja(oc.lojaNome)}</span>}
                                {!oc.expiraComPromocao && oc.atrasado && <span className="agenda-atrasada-tag">Atrasada</span>}
                              </span>
                              {oc.expiraComPromocao && (
                                <span className={`agenda-promocao-aviso agenda-promocao-aviso-${urgencia}`}>
                                  {textoPromocao(oc.promocaoNome, oc.promocaoDiasRestantes)}
                                </span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
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
                    {t.expiraComPromocao && <span className="agenda-loja-tag">Vinculada à promoção</span>}
                    {t.descricao && <div className="financeiro-td-mudo">{t.descricao}</div>}
                  </td>
                  <td>{t.expiraComPromocao ? "Diária" : `A cada ${t.intervaloDias} dia${t.intervaloDias > 1 ? "s" : ""}`}</td>
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

      {aba === "relatorio" && (
        <div className="agenda-relatorio">
          <div className="agenda-relatorio-form">
            <textarea
              className="clonar-input agenda-relatorio-textarea"
              placeholder='Ex.: "SKUs criados: https://produto.mercadolivre.com.br/MLB-..."'
              value={novoRelatorio}
              onChange={(e) => setNovoRelatorio(e.target.value)}
              rows={3}
            />
            <button
              type="button"
              className="btn-responder"
              onClick={enviarRelatorio}
              disabled={enviandoRelatorio || !novoRelatorio.trim()}
            >
              {enviandoRelatorio ? "Adicionando..." : "Adicionar ao relatório"}
            </button>
          </div>

          {relatorios === null && <div className="state-message">Carregando relatório...</div>}
          {relatorios?.length === 0 && <div className="state-message">Nada registrado ainda.</div>}
          {relatorios && relatorios.length > 0 && (
            <div className="agenda-relatorio-lista">
              {relatorios.map((r) => (
                <div key={r.id} className="agenda-relatorio-item">
                  <div className="agenda-relatorio-item-topo">
                    <span className="agenda-relatorio-autor">{r.usuarioNome}</span>
                    <span className="agenda-relatorio-data">{formatDataHora(r.criadoEm)}</span>
                    <button
                      type="button"
                      className="agenda-relatorio-excluir"
                      onClick={() => excluirEntradaRelatorio(r.id)}
                      title="Excluir"
                    >
                      ×
                    </button>
                  </div>
                  <div className="agenda-relatorio-texto">{renderComLinks(r.texto)}</div>
                </div>
              ))}
            </div>
          )}
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
