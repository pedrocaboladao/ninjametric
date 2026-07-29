import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Coluna, Cartao } from "../types/tarefas";
import { CartaoTarefa } from "./CartaoTarefa";
import { IconPlus, IconMore, IconLock, IconArchiveBox } from "./icons";

const CORES_PRESET = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

interface Props {
  coluna: Coluna;
  onConcluirCartao: (cartao: Cartao, concluido: boolean) => void;
  onExcluirCartao: (id: number) => void;
  onAdicionarCartao: (colunaId: number, titulo: string) => void;
  onRenomear: (id: number, nome: string) => void;
  onExcluirColuna: (id: number) => void;
  onMudarCor: (id: number, cor: string | null) => void;
  onArquivarConcluidos: () => void;
}

export function ColunaTarefas({
  coluna,
  onConcluirCartao,
  onExcluirCartao,
  onAdicionarCartao,
  onRenomear,
  onExcluirColuna,
  onMudarCor,
  onArquivarConcluidos,
}: Props) {
  const [menuAberto, setMenuAberto] = useState(false);
  const [editandoNome, setEditandoNome] = useState(false);
  const [nomeTemp, setNomeTemp] = useState(coluna.nome);
  const [adicionando, setAdicionando] = useState(false);
  const [tituloNovoCartao, setTituloNovoCartao] = useState("");

  const { setNodeRef } = useDroppable({ id: `coluna-${coluna.id}` });
  const especial = coluna.especial === "concluidos";

  function confirmarRenomear() {
    if (nomeTemp.trim() && nomeTemp.trim() !== coluna.nome) {
      onRenomear(coluna.id, nomeTemp.trim());
    }
    setEditandoNome(false);
  }

  function confirmarNovoCartao(e: React.FormEvent) {
    e.preventDefault();
    if (!tituloNovoCartao.trim()) return;
    onAdicionarCartao(coluna.id, tituloNovoCartao.trim());
    setTituloNovoCartao("");
    setAdicionando(false);
  }

  return (
    <div
      className="tarefa-coluna"
      style={coluna.cor ? { borderTopColor: coluna.cor, borderTopWidth: "3px" } : undefined}
    >
      <div className="tarefa-coluna-topo">
        {editandoNome ? (
          <input
            className="tarefa-coluna-nome-input"
            value={nomeTemp}
            autoFocus
            onChange={(e) => setNomeTemp(e.target.value)}
            onBlur={confirmarRenomear}
            onKeyDown={(e) => e.key === "Enter" && confirmarRenomear()}
          />
        ) : (
          <span
            className="tarefa-coluna-nome"
            onClick={() => !especial && setEditandoNome(true)}
          >
            {especial && <IconLock />} {coluna.nome.toUpperCase()}
          </span>
        )}
        <span className="tarefa-coluna-contagem">{coluna.cartoes.length}</span>
        <button className="tarefa-coluna-icone-btn" onClick={() => setAdicionando(true)} title="Adicionar cartão">
          <IconPlus size={15} />
        </button>
        {!especial && (
          <div className="tarefa-coluna-menu-wrap">
            <button className="tarefa-coluna-icone-btn" onClick={() => setMenuAberto((v) => !v)} title="Opções">
              <IconMore />
            </button>
            {menuAberto && (
              <div className="tarefa-coluna-menu">
                <button
                  onClick={() => {
                    setEditandoNome(true);
                    setMenuAberto(false);
                  }}
                >
                  Renomear
                </button>
                <div className="tarefa-coluna-cores">
                  <button
                    className={`tarefa-coluna-cor-opcao tarefa-coluna-cor-nenhuma ${
                      !coluna.cor ? "tarefa-coluna-cor-ativa" : ""
                    }`}
                    onClick={() => {
                      onMudarCor(coluna.id, null);
                      setMenuAberto(false);
                    }}
                    title="Sem cor"
                  />
                  {CORES_PRESET.map((cor) => (
                    <button
                      key={cor}
                      className={`tarefa-coluna-cor-opcao ${
                        coluna.cor === cor ? "tarefa-coluna-cor-ativa" : ""
                      }`}
                      style={{ background: cor }}
                      onClick={() => {
                        onMudarCor(coluna.id, cor);
                        setMenuAberto(false);
                      }}
                      title={cor}
                    />
                  ))}
                </div>
                <button
                  className="tarefa-coluna-menu-excluir"
                  onClick={() => {
                    onExcluirColuna(coluna.id);
                    setMenuAberto(false);
                  }}
                >
                  Excluir coluna
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div ref={setNodeRef} className="tarefa-coluna-lista">
        <SortableContext items={coluna.cartoes.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {coluna.cartoes.map((cartao) => (
            <CartaoTarefa
              key={cartao.id}
              cartao={cartao}
              onConcluir={onConcluirCartao}
              onExcluir={onExcluirCartao}
            />
          ))}
        </SortableContext>

        {adicionando ? (
          <form className="tarefa-novo-cartao-form" onSubmit={confirmarNovoCartao}>
            <textarea
              className="tarefa-novo-cartao-input"
              autoFocus
              rows={2}
              value={tituloNovoCartao}
              onChange={(e) => setTituloNovoCartao(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  confirmarNovoCartao(e);
                }
                if (e.key === "Escape") setAdicionando(false);
              }}
              placeholder="Título do cartão..."
            />
            <div className="tarefa-novo-cartao-acoes">
              <button type="submit" className="btn-responder">
                Adicionar
              </button>
              <button type="button" className="btn-excluir" onClick={() => setAdicionando(false)}>
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <button className="tarefa-adicionar-cartao" onClick={() => setAdicionando(true)}>
            <IconPlus size={14} /> Adicionar um cartão
          </button>
        )}

        {especial && coluna.cartoes.length > 0 && (
          <button className="tarefa-arquivar-concluidos" onClick={onArquivarConcluidos}>
            <IconArchiveBox size={14} /> Arquivar concluídos
          </button>
        )}
      </div>
    </div>
  );
}
