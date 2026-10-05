import { useState } from "react";
import { Modal } from "./Modal";
import type { TarefaAgenda, UsuarioParaAtribuir, LojaParaAgenda, NovaTarefaAgenda } from "../types/agenda";

interface Props {
  tarefa: TarefaAgenda | null;
  usuarios: UsuarioParaAtribuir[];
  lojas: LojaParaAgenda[];
  salvando: boolean;
  erro: string | null;
  onSalvar: (dados: NovaTarefaAgenda) => void;
  onFechar: () => void;
}

function hojeISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function AgendaTarefaModal({ tarefa, usuarios, lojas, salvando, erro, onSalvar, onFechar }: Props) {
  const [titulo, setTitulo] = useState(tarefa?.titulo ?? "");
  const [descricao, setDescricao] = useState(tarefa?.descricao ?? "");
  const [intervaloDias, setIntervaloDias] = useState(String(tarefa?.intervaloDias ?? 7));
  const [dataInicio, setDataInicio] = useState(tarefa?.dataInicio ?? hojeISO());
  // Sem "Qualquer um": a lista já vem restrita só ao Brunão (decisão do
  // dono), então o valor padrão já cai nele quando só existe uma opção.
  const [atribuidoAUsuarioId, setAtribuidoAUsuarioId] = useState(() => {
    if (tarefa?.atribuidoAUsuarioId != null) return String(tarefa.atribuidoAUsuarioId);
    return usuarios.length === 1 ? String(usuarios[0].id) : "";
  });
  const [lojaId, setLojaId] = useState(tarefa?.lojaId != null ? String(tarefa.lojaId) : "");

  function submeter(e: React.FormEvent) {
    e.preventDefault();
    const intervalo = Number(intervaloDias);
    if (!titulo.trim() || !Number.isInteger(intervalo) || intervalo <= 0 || !dataInicio) return;
    onSalvar({
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      intervaloDias: intervalo,
      dataInicio,
      atribuidoAUsuarioId: atribuidoAUsuarioId ? Number(atribuidoAUsuarioId) : null,
      lojaId: lojaId ? Number(lojaId) : null,
    });
  }

  return (
    <Modal
      titulo={tarefa ? "Editar tarefa" : "Nova tarefa recorrente"}
      onFechar={onFechar}
      rodape={
        <>
          <button type="button" className="btn-excluir" onClick={onFechar}>
            Cancelar
          </button>
          <button type="submit" form="agenda-tarefa-form" className="btn-responder" disabled={salvando}>
            {salvando ? "Salvando..." : "Salvar"}
          </button>
        </>
      }
    >
      <form id="agenda-tarefa-form" className="tarefa-cartao-modal-form" onSubmit={submeter}>
        {erro && <div className="clonar-erro">{erro}</div>}
        <label>
          Título
          <input
            type="text"
            className="clonar-input"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex.: Checar estoque das 10 primeiras páginas"
            required
          />
        </label>
        <label>
          Descrição (opcional)
          <textarea className="clonar-input" value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} />
        </label>
        <label>
          Repetir a cada quantos dias
          <input
            type="number"
            min={1}
            className="clonar-input"
            value={intervaloDias}
            onChange={(e) => setIntervaloDias(e.target.value)}
            required
          />
        </label>
        <label>
          Data de início
          <input
            type="date"
            className="clonar-input"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            required
          />
        </label>
        <label>
          Responsável
          <select className="clonar-input" value={atribuidoAUsuarioId} onChange={(e) => setAtribuidoAUsuarioId(e.target.value)}>
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
    </Modal>
  );
}
