import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Cartao } from "../types/tarefas";
import { IconTrash } from "./icons";

interface Props {
  cartao: Cartao;
  onConcluir: (cartao: Cartao, concluido: boolean) => void;
  onExcluir: (id: number) => void;
  // true dentro da coluna sintética "Compartilhadas comigo" — o destinatário
  // só pode marcar concluído, não arrasta nem exclui (ver tarefasService.ts).
  somenteConcluir?: boolean;
}

export function CartaoTarefa({ cartao, onConcluir, onExcluir, somenteConcluir = false }: Props) {
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cartao.id,
    disabled: somenteConcluir,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="tarefa-cartao"
      {...(somenteConcluir ? {} : attributes)}
      {...(somenteConcluir ? {} : listeners)}
    >
      <label className="tarefa-cartao-checkbox" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={cartao.concluido}
          onChange={(e) => onConcluir(cartao, e.target.checked)}
        />
      </label>
      <span className={`tarefa-cartao-titulo ${cartao.concluido ? "tarefa-cartao-titulo-concluido" : ""}`}>
        {cartao.titulo}
      </span>
      {cartao.criadoPorNome && <span className="tarefa-cartao-tag-compartilhado">de {cartao.criadoPorNome}</span>}
      {cartao.compartilhadoComNome && (
        <span className="tarefa-cartao-tag-compartilhado" title={`Compartilhado com ${cartao.compartilhadoComNome}`}>
          ↗ {cartao.compartilhadoComNome}
        </span>
      )}
      {!somenteConcluir &&
        (confirmandoExclusao ? (
          <span className="tarefa-cartao-confirmar" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => onExcluir(cartao.id)}>Excluir</button>
            <button onClick={() => setConfirmandoExclusao(false)}>Cancelar</button>
          </span>
        ) : (
          <button
            className="tarefa-cartao-excluir"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmandoExclusao(true);
            }}
            title="Excluir cartão"
          >
            <IconTrash size={13} />
          </button>
        ))}
    </div>
  );
}
