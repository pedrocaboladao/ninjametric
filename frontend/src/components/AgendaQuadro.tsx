import { useCallback, useEffect, useState } from "react";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import type {
  AnexoCardAgenda,
  CardQuadroAgenda,
  ColunaQuadroAgenda,
  DadosCardQuadroAgenda,
  LojaParaAgenda,
  UsuarioParaAtribuir,
} from "../types/agenda";
import {
  urlAnexoCardAgenda,
  fetchAnexosCardAgenda,
  enviarAnexoCardAgenda,
  excluirAnexoCardAgenda,
  definirCapaAnexoAgenda,
  fetchQuadroAgenda,
  criarColunaQuadroAgenda,
  renomearColunaQuadroAgenda,
  excluirColunaQuadroAgenda,
  criarCardQuadroAgenda,
  atualizarCardQuadroAgenda,
  moverCardQuadroAgenda,
  excluirCardQuadroAgenda,
  clonarCardQuadroAgenda,
} from "../api/agenda";
import { Modal } from "./Modal";
import { IconPlus } from "./icons";

function nomeCurtoDaLoja(nome: string): string {
  return nome === "Catedral Impermeabilizantes" ? "Catedral" : nome;
}

interface CardProps {
  card: CardQuadroAgenda;
  onAbrir: (card: CardQuadroAgenda) => void;
}

function CardItem({ card, onAbrir }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `card-${card.id}` });
  const estilo = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <div
      ref={setNodeRef}
      style={estilo}
      {...listeners}
      {...attributes}
      className={`agenda-quadro-card ${isDragging ? "agenda-quadro-card-arrastando" : ""}`}
      onClick={() => onAbrir(card)}
    >
      {card.capaAnexoId && <img className="agenda-quadro-capa" src={urlAnexoCardAgenda(card.capaAnexoId)} alt="" />}
      <span className="agenda-ocorrencia-titulo">{card.titulo}</span>
      <div className="agenda-ocorrencia-meta">
        <span>{card.atribuidoANome ?? "Sem responsável"}</span>
        {card.lojaNome && <span className="agenda-loja-tag">{nomeCurtoDaLoja(card.lojaNome)}</span>}
        {card.totalAnexos > 0 && <span className="financeiro-td-mudo">📎 {card.totalAnexos}</span>}
      </div>
    </div>
  );
}

interface ColunaProps {
  coluna: ColunaQuadroAgenda;
  onNovoCard: (colunaId: number) => void;
  onRenomear: (coluna: ColunaQuadroAgenda) => void;
  onExcluir: (coluna: ColunaQuadroAgenda) => void;
  onAbrirCard: (card: CardQuadroAgenda) => void;
}

function ColunaItem({ coluna, onNovoCard, onRenomear, onExcluir, onAbrirCard }: ColunaProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `coluna-${coluna.id}` });
  return (
    <div className={`agenda-quadro-coluna ${isOver ? "agenda-quadro-coluna-sobre" : ""}`}>
      <div className="agenda-quadro-coluna-topo">
        <span className="agenda-dia-nome">{coluna.nome}</span>
        <span className="financeiro-td-mudo">{coluna.cards.length}</span>
        <div className="agenda-quadro-coluna-acoes">
          <button type="button" className="agenda-relatorio-excluir" onClick={() => onRenomear(coluna)} title="Renomear">
            ✎
          </button>
          <button type="button" className="agenda-relatorio-excluir" onClick={() => onExcluir(coluna)} title="Excluir coluna">
            ×
          </button>
        </div>
      </div>
      <div ref={setNodeRef} className="agenda-quadro-coluna-corpo">
        {coluna.cards.map((card) => (
          <CardItem key={card.id} card={card} onAbrir={onAbrirCard} />
        ))}
      </div>
      <button type="button" className="agenda-quadro-novo-card" onClick={() => onNovoCard(coluna.id)}>
        <IconPlus size={12} /> Novo card
      </button>
    </div>
  );
}

interface AnexosCardProps {
  cardId: number;
  onMudou: () => void;
}

function AnexosCard({ cardId, onMudou }: AnexosCardProps) {
  const [anexos, setAnexos] = useState<AnexoCardAgenda[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setAnexos(await fetchAnexosCardAgenda(cardId));
      setErro(null);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao carregar anexos.");
    }
  }, [cardId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function enviar(arquivo: File) {
    setEnviando(true);
    setErro(null);
    try {
      await enviarAnexoCardAgenda(cardId, arquivo);
      await carregar();
      onMudou();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao anexar o arquivo.");
    } finally {
      setEnviando(false);
    }
  }

  async function excluir(anexo: AnexoCardAgenda) {
    if (!window.confirm(`Excluir o arquivo "${anexo.nome}"?`)) return;
    try {
      await excluirAnexoCardAgenda(anexo.id);
      await carregar();
      onMudou();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao excluir o arquivo.");
    }
  }

  async function alternarCapa(anexo: AnexoCardAgenda) {
    try {
      await definirCapaAnexoAgenda(anexo.id, !anexo.capa);
      await carregar();
      onMudou();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao definir a capa.");
    }
  }

  return (
    <div className="agenda-card-anexos">
      <div className="agenda-card-anexos-topo">
        <span className="agenda-dia-nome">Arquivos</span>
        <label className="btn-responder agenda-card-anexos-botao">
          {enviando ? "Enviando..." : "Adicionar arquivo"}
          <input
            type="file"
            hidden
            disabled={enviando}
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              if (arquivo) enviar(arquivo);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {erro && <div className="clonar-erro">{erro}</div>}
      {anexos === null && !erro && <div className="state-message">Carregando...</div>}
      {anexos?.length === 0 && <div className="financeiro-td-mudo">Nenhum arquivo ainda.</div>}
      {anexos?.map((anexo) => (
        <div key={anexo.id} className="agenda-card-anexo">
          <a href={urlAnexoCardAgenda(anexo.id)} target="_blank" rel="noopener noreferrer" className="agenda-relatorio-link">
            {anexo.nome}
          </a>
          <div className="agenda-card-anexo-acoes">
            {anexo.tipo.startsWith("image/") && (
              <button type="button" className="btn-responder" onClick={() => alternarCapa(anexo)}>
                {anexo.capa ? "Tirar da capa" : "Usar como capa"}
              </button>
            )}
            <button type="button" className="btn-excluir" onClick={() => excluir(anexo)}>
              Excluir
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

interface CardModalProps {
  card: CardQuadroAgenda | null;
  colunas: ColunaQuadroAgenda[];
  colunaAtualId: number | null;
  usuarios: UsuarioParaAtribuir[];
  lojas: LojaParaAgenda[];
  onSalvar: (dados: DadosCardQuadroAgenda) => void;
  onExcluir: () => void;
  onFechar: () => void;
  onAnexosMudaram: () => void;
}

function CardModal({ card, colunas, colunaAtualId, usuarios, lojas, onSalvar, onExcluir, onFechar, onAnexosMudaram }: CardModalProps) {
  const [colunaDestinoId, setColunaDestinoId] = useState("");
  const [clonando, setClonando] = useState(false);
  const [erroClonar, setErroClonar] = useState<string | null>(null);
  const outrasColunas = colunas.filter((c) => c.id !== colunaAtualId);

  async function clonar() {
    if (!card || !colunaDestinoId) return;
    setClonando(true);
    setErroClonar(null);
    try {
      await clonarCardQuadroAgenda(card.id, Number(colunaDestinoId));
      onAnexosMudaram();
      onFechar();
    } catch (err) {
      setErroClonar(err instanceof Error ? err.message : "Falha ao clonar card.");
    } finally {
      setClonando(false);
    }
  }
  const [titulo, setTitulo] = useState(card?.titulo ?? "");
  const [descricao, setDescricao] = useState(card?.descricao ?? "");
  const [atribuidoAUsuarioId, setAtribuidoAUsuarioId] = useState(
    card?.atribuidoAUsuarioId != null ? String(card.atribuidoAUsuarioId) : ""
  );
  const [lojaId, setLojaId] = useState(card?.lojaId != null ? String(card.lojaId) : "");

  function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo.trim()) return;
    onSalvar({
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      atribuidoAUsuarioId: atribuidoAUsuarioId ? Number(atribuidoAUsuarioId) : null,
      lojaId: lojaId ? Number(lojaId) : null,
    });
  }

  return (
    <Modal
      titulo={card ? "Editar card" : "Novo card"}
      onFechar={onFechar}
      rodape={
        <>
          {card && (
            <button type="button" className="btn-excluir" onClick={onExcluir}>
              Excluir
            </button>
          )}
          <button type="button" className="btn-excluir" onClick={onFechar}>
            Cancelar
          </button>
          <button type="submit" form="agenda-quadro-card-form" className="btn-responder">
            Salvar
          </button>
        </>
      }
    >
      <form id="agenda-quadro-card-form" className="tarefa-cartao-modal-form" onSubmit={submeter}>
        <label>
          Título
          <input type="text" className="clonar-input" value={titulo} onChange={(e) => setTitulo(e.target.value)} required />
        </label>
        <label>
          Descrição (opcional)
          <textarea className="clonar-input" value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} />
        </label>
        <label>
          Responsável
          <select className="clonar-input" value={atribuidoAUsuarioId} onChange={(e) => setAtribuidoAUsuarioId(e.target.value)}>
            <option value="">Sem responsável</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </select>
        </label>
        <label>
          Loja (opcional)
          <select className="clonar-input" value={lojaId} onChange={(e) => setLojaId(e.target.value)}>
            <option value="">Sem loja específica</option>
            {lojas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </select>
        </label>
      </form>
      {card && <AnexosCard cardId={card.id} onMudou={onAnexosMudaram} />}
      {card && outrasColunas.length > 0 && (
        <div className="agenda-card-anexos">
          <span className="agenda-dia-nome">Clonar para outra coluna</span>
          {erroClonar && <div className="clonar-erro">{erroClonar}</div>}
          <div className="agenda-card-anexo">
            <select className="clonar-input" value={colunaDestinoId} onChange={(e) => setColunaDestinoId(e.target.value)}>
              <option value="">Escolha a coluna</option>
              {outrasColunas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
            <button type="button" className="btn-responder" onClick={clonar} disabled={!colunaDestinoId || clonando}>
              {clonando ? "Clonando..." : "Clonar"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

interface Props {
  usuarios: UsuarioParaAtribuir[];
  lojas: LojaParaAgenda[];
}

export function AgendaQuadro({ usuarios, lojas }: Props) {
  const [colunas, setColunas] = useState<ColunaQuadroAgenda[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [cardModal, setCardModal] = useState<{ card: CardQuadroAgenda | null; colunaId: number | null } | null>(null);
  const [erroModal, setErroModal] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const carregar = useCallback(async () => {
    try {
      setColunas(await fetchQuadroAgenda());
      setErro(null);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao carregar o quadro.");
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function executar(acao: () => Promise<void>) {
    try {
      await acao();
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao atualizar o quadro.");
    }
  }

  function aoSoltar(evento: DragEndEvent) {
    const { active, over } = evento;
    if (!over || !colunas) return;
    const cardId = Number(String(active.id).replace("card-", ""));
    const colunaDestinoId = Number(String(over.id).replace("coluna-", ""));
    const origem = colunas.find((c) => c.cards.some((card) => card.id === cardId));
    if (!origem || origem.id === colunaDestinoId) return;
    executar(() => moverCardQuadroAgenda(cardId, colunaDestinoId));
  }

  async function novaColuna() {
    const nome = window.prompt("Nome da nova coluna:");
    if (!nome || !nome.trim()) return;
    await executar(() => criarColunaQuadroAgenda(nome.trim()));
  }

  async function renomearColuna(coluna: ColunaQuadroAgenda) {
    const nome = window.prompt("Novo nome da coluna:", coluna.nome);
    if (!nome || !nome.trim() || nome.trim() === coluna.nome) return;
    await executar(() => renomearColunaQuadroAgenda(coluna.id, nome.trim()));
  }

  async function excluirColuna(coluna: ColunaQuadroAgenda) {
    if (!window.confirm(`Excluir a coluna "${coluna.nome}"?`)) return;
    try {
      await excluirColunaQuadroAgenda(coluna.id);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao excluir coluna.");
    }
  }

  async function salvarCard(dados: DadosCardQuadroAgenda) {
    if (!cardModal) return;
    setErroModal(null);
    try {
      if (cardModal.card) {
        await atualizarCardQuadroAgenda(cardModal.card.id, dados);
      } else if (cardModal.colunaId !== null) {
        await criarCardQuadroAgenda(cardModal.colunaId, dados);
      }
      setCardModal(null);
      await carregar();
    } catch (err) {
      setErroModal(err instanceof Error ? err.message : "Falha ao salvar card.");
    }
  }

  async function excluirCardAtual() {
    if (!cardModal?.card) return;
    if (!window.confirm(`Excluir o card "${cardModal.card.titulo}"?`)) return;
    try {
      await excluirCardQuadroAgenda(cardModal.card.id);
      setCardModal(null);
      await carregar();
    } catch (err) {
      setErroModal(err instanceof Error ? err.message : "Falha ao excluir card.");
    }
  }

  return (
    <div className="agenda-quadro">
      <div className="agenda-quadro-topo">
        <span className="painel-eyebrow">Quadro</span>
        <button type="button" className="btn-responder" onClick={novaColuna}>
          <IconPlus size={14} /> Nova coluna
        </button>
      </div>

      {erro && <div className="clonar-erro">{erro}</div>}
      {!colunas && !erro && <div className="state-message">Carregando quadro...</div>}

      {colunas && (
        <DndContext sensors={sensors} onDragEnd={aoSoltar}>
          <div className="agenda-quadro-colunas">
            {colunas.map((coluna) => (
              <ColunaItem
                key={coluna.id}
                coluna={coluna}
                onNovoCard={(colunaId) => setCardModal({ card: null, colunaId })}
                onRenomear={renomearColuna}
                onExcluir={excluirColuna}
                onAbrirCard={(card) => setCardModal({ card, colunaId: null })}
              />
            ))}
          </div>
        </DndContext>
      )}

      {cardModal && (
        <CardModal
          card={cardModal.card}
          usuarios={usuarios}
          lojas={lojas}
          onSalvar={salvarCard}
          onExcluir={excluirCardAtual}
          onAnexosMudaram={carregar}
          colunas={colunas ?? []}
          colunaAtualId={cardModal.card ? (colunas?.find((c) => c.cards.some((x) => x.id === cardModal.card!.id))?.id ?? null) : null}
          onFechar={() => {
            setCardModal(null);
            setErroModal(null);
          }}
        />
      )}
      {cardModal && erroModal && <div className="clonar-erro">{erroModal}</div>}
    </div>
  );
}
