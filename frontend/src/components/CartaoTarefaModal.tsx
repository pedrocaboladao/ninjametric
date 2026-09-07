import { useState } from "react";
import { Modal } from "./Modal";
import type { Cartao } from "../types/tarefas";

interface Props {
  cartao: Cartao;
  // true pra cartão da coluna sintética "Compartilhadas comigo" — o
  // destinatário só lê, não edita (mesma regra do backend, ver
  // tarefasService.ts).
  somenteLeitura: boolean;
  salvando: boolean;
  erro: string | null;
  onSalvar: (titulo: string, descricao: string) => void;
  onFechar: () => void;
}

export function CartaoTarefaModal({ cartao, somenteLeitura, salvando, erro, onSalvar, onFechar }: Props) {
  const [titulo, setTitulo] = useState(cartao.titulo);
  const [descricao, setDescricao] = useState(cartao.descricao ?? "");

  const subtitulo = cartao.criadoPorNome
    ? `Compartilhado por ${cartao.criadoPorNome}`
    : cartao.compartilhadoComNome
      ? `Compartilhado com ${cartao.compartilhadoComNome}`
      : undefined;

  return (
    <Modal
      titulo={somenteLeitura ? cartao.titulo : "Editar cartão"}
      subtitulo={subtitulo}
      onFechar={onFechar}
      rodape={
        somenteLeitura ? (
          <button type="button" className="btn-responder" onClick={onFechar}>
            Fechar
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn-responder"
              disabled={salvando || !titulo.trim()}
              onClick={() => onSalvar(titulo.trim(), descricao)}
            >
              {salvando ? "Salvando..." : "Salvar"}
            </button>
            <button type="button" className="btn-excluir" onClick={onFechar}>
              Cancelar
            </button>
          </>
        )
      }
    >
      {erro && <div className="clonar-erro">{erro}</div>}
      {somenteLeitura ? (
        <p className="tarefa-cartao-modal-descricao">{cartao.descricao || "Sem descrição."}</p>
      ) : (
        <div className="tarefa-cartao-modal-form">
          <input
            className="clonar-input"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Título"
          />
          <textarea
            className="tarefa-novo-cartao-input tarefa-cartao-modal-textarea"
            rows={8}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Descrição detalhada (opcional)..."
          />
        </div>
      )}
    </Modal>
  );
}
