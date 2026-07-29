import { useEffect, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import type { Coluna, Cartao, CartaoArquivado } from "../types/tarefas";
import {
  fetchQuadro,
  criarColuna,
  renomearColuna,
  excluirColuna,
  criarCartao,
  atualizarCartao,
  excluirCartao,
  reindexarColuna,
  arquivarConcluidos,
  fetchArquivados,
  restaurarCartao,
} from "../api/tarefas";
import { ColunaTarefas } from "./ColunaTarefas";
import { CartaoTarefa } from "./CartaoTarefa";
import { TarefasArquivados } from "./TarefasArquivados";
import { IconPlus } from "./icons";

const CHAVE_ARQUIVAR_DIRETO = "tarefas_arquivar_direto";

export function Tarefas() {
  const [colunas, setColunas] = useState<Coluna[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<"pessoal" | "arquivados">("pessoal");
  const [arquivados, setArquivados] = useState<CartaoArquivado[] | null>(null);
  const [arquivarDireto, setArquivarDireto] = useState(() => localStorage.getItem(CHAVE_ARQUIVAR_DIRETO) === "1");
  const [activeCartao, setActiveCartao] = useState<Cartao | null>(null);
  const [novaColunaAberta, setNovaColunaAberta] = useState(false);
  const [nomeNovaColuna, setNomeNovaColuna] = useState("");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    carregarQuadro();
  }, []);

  useEffect(() => {
    localStorage.setItem(CHAVE_ARQUIVAR_DIRETO, arquivarDireto ? "1" : "0");
  }, [arquivarDireto]);

  async function carregarQuadro() {
    try {
      setColunas(await fetchQuadro());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao carregar quadro.");
    }
  }

  async function carregarArquivados() {
    try {
      setArquivados(await fetchArquivados());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao carregar arquivados.");
    }
  }

  function mudarAba(novaAba: "pessoal" | "arquivados") {
    setAba(novaAba);
    if (novaAba === "arquivados") carregarArquivados();
  }

  function encontrarColunaDoCartao(colunasAtuais: Coluna[], cartaoId: number): Coluna | undefined {
    return colunasAtuais.find((c) => c.cartoes.some((cartao) => cartao.id === cartaoId));
  }

  function handleDragStart(event: DragStartEvent) {
    if (!colunas) return;
    const coluna = encontrarColunaDoCartao(colunas, Number(event.active.id));
    const cartao = coluna?.cartoes.find((c) => c.id === Number(event.active.id));
    setActiveCartao(cartao ?? null);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || !colunas) return;

    const activeId = Number(active.id);
    const overId = String(over.id);

    const colunaOrigem = encontrarColunaDoCartao(colunas, activeId);
    if (!colunaOrigem) return;

    const colunaDestino = overId.startsWith("coluna-")
      ? colunas.find((c) => c.id === Number(overId.replace("coluna-", "")))
      : encontrarColunaDoCartao(colunas, Number(overId));

    if (!colunaDestino || colunaOrigem.id === colunaDestino.id) return;

    setColunas((atual) => {
      if (!atual) return atual;
      const origem = atual.find((c) => c.id === colunaOrigem.id)!;
      const destino = atual.find((c) => c.id === colunaDestino.id)!;
      const cartao = origem.cartoes.find((c) => c.id === activeId)!;

      const novaOrigemCartoes = origem.cartoes.filter((c) => c.id !== activeId);
      const indexDestino = overId.startsWith("coluna-")
        ? destino.cartoes.length
        : destino.cartoes.findIndex((c) => c.id === Number(overId));
      const novoDestinoCartoes = [...destino.cartoes];
      novoDestinoCartoes.splice(indexDestino < 0 ? destino.cartoes.length : indexDestino, 0, {
        ...cartao,
        colunaId: destino.id,
      });

      return atual.map((c) => {
        if (c.id === origem.id) return { ...c, cartoes: novaOrigemCartoes };
        if (c.id === destino.id) return { ...c, cartoes: novoDestinoCartoes };
        return c;
      });
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveCartao(null);
    if (!over || !colunas) return;

    const activeId = Number(active.id);
    const overId = String(over.id);
    const colunaAtual = encontrarColunaDoCartao(colunas, activeId);
    if (!colunaAtual) return;

    let cartoesFinais = colunaAtual.cartoes;
    if (!overId.startsWith("coluna-")) {
      const overIndex = colunaAtual.cartoes.findIndex((c) => c.id === Number(overId));
      const activeIndex = colunaAtual.cartoes.findIndex((c) => c.id === activeId);
      if (overIndex >= 0 && activeIndex >= 0 && overIndex !== activeIndex) {
        cartoesFinais = arrayMove(colunaAtual.cartoes, activeIndex, overIndex);
        setColunas((atual) =>
          atual ? atual.map((c) => (c.id === colunaAtual.id ? { ...c, cartoes: cartoesFinais } : c)) : atual
        );
      }
    }

    try {
      await reindexarColuna(
        colunaAtual.id,
        cartoesFinais.map((c) => c.id)
      );
      if (colunaAtual.especial === "concluidos") {
        await atualizarCartao(activeId, { concluido: true });
      }
    } catch {
      carregarQuadro();
    }
  }

  async function handleConcluirCartao(cartao: Cartao, concluido: boolean) {
    if (!colunas) return;
    const colunaConcluidos = colunas.find((c) => c.especial === "concluidos");

    if (concluido && colunaConcluidos) {
      if (arquivarDireto) {
        await atualizarCartao(cartao.id, { concluido: true, arquivado: true });
      } else {
        await atualizarCartao(cartao.id, { concluido: true, colunaId: colunaConcluidos.id });
      }
    } else {
      await atualizarCartao(cartao.id, { concluido });
    }
    carregarQuadro();
  }

  async function handleExcluirCartao(id: number) {
    await excluirCartao(id);
    carregarQuadro();
  }

  async function handleAdicionarCartao(colunaId: number, titulo: string) {
    await criarCartao(colunaId, titulo);
    carregarQuadro();
  }

  async function handleRenomearColuna(id: number, nome: string) {
    await renomearColuna(id, nome);
    carregarQuadro();
  }

  async function handleExcluirColuna(id: number) {
    await excluirColuna(id);
    carregarQuadro();
  }

  async function handleArquivarConcluidos() {
    await arquivarConcluidos();
    carregarQuadro();
  }

  async function handleRestaurar(id: number, colunaId: number) {
    await restaurarCartao(id, colunaId);
    carregarArquivados();
    carregarQuadro();
  }

  async function handleCriarColuna(e: React.FormEvent) {
    e.preventDefault();
    if (!nomeNovaColuna.trim()) return;
    await criarColuna(nomeNovaColuna.trim());
    setNomeNovaColuna("");
    setNovaColunaAberta(false);
    carregarQuadro();
  }

  return (
    <div className="tarefas">
      <div className="tarefas-topo">
        <span className="painel-eyebrow">Tarefas</span>
        <h1>Quadro de tarefas</h1>
      </div>

      <div className="tarefas-abas-linha">
        <div className="tarefas-abas">
          <button
            className={`tarefas-aba ${aba === "pessoal" ? "tarefas-aba-ativa" : ""}`}
            onClick={() => mudarAba("pessoal")}
          >
            Pessoal
          </button>
          <button
            className={`tarefas-aba ${aba === "arquivados" ? "tarefas-aba-ativa" : ""}`}
            onClick={() => mudarAba("arquivados")}
          >
            Arquivados
          </button>
        </div>

        {aba === "pessoal" && (
          <label className="tarefas-toggle">
            <input
              type="checkbox"
              checked={arquivarDireto}
              onChange={(e) => setArquivarDireto(e.target.checked)}
            />
            Arquivar concluídas direto
          </label>
        )}
      </div>

      {erro && <div className="clonar-erro">{erro}</div>}

      {aba === "arquivados" && (
        <TarefasArquivados cartoes={arquivados ?? []} colunas={colunas ?? []} onRestaurar={handleRestaurar} />
      )}

      {aba === "pessoal" && !colunas && <div className="state-message">Carregando quadro...</div>}

      {aba === "pessoal" && colunas && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="tarefas-quadro">
            {colunas.map((coluna) => (
              <ColunaTarefas
                key={coluna.id}
                coluna={coluna}
                onConcluirCartao={handleConcluirCartao}
                onExcluirCartao={handleExcluirCartao}
                onAdicionarCartao={handleAdicionarCartao}
                onRenomear={handleRenomearColuna}
                onExcluirColuna={handleExcluirColuna}
                onArquivarConcluidos={handleArquivarConcluidos}
              />
            ))}

            <div className="tarefa-nova-coluna">
              {novaColunaAberta ? (
                <form onSubmit={handleCriarColuna}>
                  <input
                    className="clonar-input"
                    autoFocus
                    value={nomeNovaColuna}
                    onChange={(e) => setNomeNovaColuna(e.target.value)}
                    placeholder="Nome da coluna"
                    onKeyDown={(e) => e.key === "Escape" && setNovaColunaAberta(false)}
                  />
                  <div className="tarefa-novo-cartao-acoes">
                    <button type="submit" className="btn-responder">
                      Criar
                    </button>
                    <button type="button" className="btn-excluir" onClick={() => setNovaColunaAberta(false)}>
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : (
                <button className="tarefa-adicionar-coluna" onClick={() => setNovaColunaAberta(true)}>
                  <IconPlus size={15} /> Nova coluna
                </button>
              )}
            </div>
          </div>

          <DragOverlay>
            {activeCartao && (
              <CartaoTarefa cartao={activeCartao} onConcluir={() => {}} onExcluir={() => {}} />
            )}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
