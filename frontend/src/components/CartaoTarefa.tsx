import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Cartao } from "../types/tarefas";
import { IconTrash } from "./icons";

interface Props {
  cartao: Cartao;
  onConcluir: (cartao: Cartao, concluido: boolean) => void;
  onExcluir: (id: number) => void;
}

export function CartaoTarefa({ cartao, onConcluir, onExcluir }: Props) {
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cartao.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="tarefa-cartao" {...attributes} {...listeners}>
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
      {confirmandoExclusao ? (
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
      )}
    </div>
  );
}
