import { useState } from "react";
import type { PerguntaPendente } from "../types/perguntas";
import { formatCurrency, formatDataHora } from "../utils/format";
import { IconTrash, IconExternalLink } from "./icons";

interface Props {
  pergunta: PerguntaPendente;
  onResponder: (lojaId: number, questionId: number, texto: string) => Promise<void>;
  onExcluir: (lojaId: number, questionId: number) => Promise<void>;
}

export function PerguntaCard({ pergunta, onResponder, onExcluir }: Props) {
  const [resposta, setResposta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function handleResponder(e: React.FormEvent) {
    e.preventDefault();
    if (!resposta.trim() || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await onResponder(pergunta.lojaId, pergunta.id, resposta.trim());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao responder.");
    } finally {
      setEnviando(false);
    }
  }

  async function handleExcluir() {
    if (excluindo) return;
    setExcluindo(true);
    setErro(null);
    try {
      await onExcluir(pergunta.lojaId, pergunta.id);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao excluir.");
      setExcluindo(false);
    }
  }

  return (
    <div className="pergunta-item">
      <div className="pergunta-produto">
        {pergunta.produto?.foto ? (
          <img className="pergunta-foto" src={pergunta.produto.foto} alt="" loading="lazy" />
        ) : (
          <div className="pergunta-foto pergunta-foto-vazia" />
        )}
        <div className="pergunta-produto-info">
          <a
            className="pergunta-produto-titulo"
            href={pergunta.produto?.linkMl ?? undefined}
            target="_blank"
            rel="noreferrer"
          >
            {pergunta.produto?.titulo ?? "Produto não encontrado"}
            <IconExternalLink />
          </a>
          {pergunta.produto && <div className="pergunta-produto-preco">{formatCurrency(pergunta.produto.preco)}</div>}
        </div>
      </div>

      <div className="pergunta-corpo">
        <div className="pergunta-meta">
          <b>{pergunta.comprador}</b> perguntou em {formatDataHora(pergunta.criadoEm)}
        </div>
        <p className="pergunta-texto">{pergunta.texto}</p>
      </div>

      <form className="pergunta-resposta" onSubmit={handleResponder}>
        <textarea
          className="pergunta-textarea"
          placeholder="Escreva sua resposta..."
          value={resposta}
          onChange={(e) => setResposta(e.target.value)}
          rows={2}
        />
        {erro && <div className="pergunta-erro">{erro}</div>}
        <div className="pergunta-acoes">
          <button type="button" className="btn-excluir" onClick={handleExcluir} disabled={excluindo}>
            <IconTrash /> {excluindo ? "Excluindo..." : "Excluir"}
          </button>
          <button type="submit" className="btn-responder" disabled={!resposta.trim() || enviando}>
            {enviando ? "Enviando..." : "Responder"}
          </button>
        </div>
      </form>
    </div>
  );
}
