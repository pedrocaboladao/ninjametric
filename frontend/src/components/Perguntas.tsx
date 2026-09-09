import { useState } from "react";
import { PerguntaCard } from "./PerguntaCard";
import { corDaLoja } from "../utils/format";
import type { PerguntaPendente } from "../types/perguntas";
import type { Usuario } from "../types/usuarios";

function agruparPorLoja(perguntas: PerguntaPendente[]): Array<{ lojaId: number; lojaNome: string; itens: PerguntaPendente[] }> {
  const grupos = new Map<number, { lojaId: number; lojaNome: string; itens: PerguntaPendente[] }>();
  for (const p of perguntas) {
    const grupo = grupos.get(p.lojaId) ?? { lojaId: p.lojaId, lojaNome: p.lojaNome, itens: [] };
    grupo.itens.push(p);
    grupos.set(p.lojaId, grupo);
  }
  return Array.from(grupos.values()).sort((a, b) => a.lojaId - b.lojaId);
}

interface Props {
  perguntas: PerguntaPendente[] | null;
  error: string | null;
  loading: boolean;
  responder: (
    lojaId: number,
    questionId: number,
    texto: string,
    contexto?: { perguntaTexto: string; produtoTitulo: string | null; respostaSugerida: string | null }
  ) => Promise<void>;
  excluir: (lojaId: number, questionId: number) => Promise<void>;
  usuario: Usuario;
}

export function Perguntas({ perguntas, error, loading, responder, excluir, usuario }: Props) {
  const [lojaFiltro, setLojaFiltro] = useState<number | "todas" | "minhas">("todas");

  if (loading) {
    return <div className="state-message">Carregando perguntas...</div>;
  }

  if (error) {
    return <div className="state-message state-error">Erro ao carregar perguntas: {error}</div>;
  }

  if (!perguntas) {
    return null;
  }

  const lojasDisponiveis = new Map<number, string>();
  for (const p of perguntas) lojasDisponiveis.set(p.lojaId, p.lojaNome);

  const perguntasFiltradas =
    lojaFiltro === "todas"
      ? perguntas
      : lojaFiltro === "minhas"
        ? perguntas.filter((p) => usuario.lojas.includes(p.lojaId))
        : perguntas.filter((p) => p.lojaId === lojaFiltro);
  const grupos = agruparPorLoja(perguntasFiltradas);

  return (
    <div className="perguntas">
      <div className="perguntas-header">
        <div>
          <h1>Perguntas</h1>
          <p className="painel-sub">Centralize e responda as perguntas das 4 contas sem entrar em cada uma.</p>
        </div>
        <div className="perguntas-header-direita">
          <select
            className="dashboard-select"
            value={lojaFiltro}
            onChange={(e) => {
              const valor = e.target.value;
              setLojaFiltro(valor === "todas" || valor === "minhas" ? valor : Number(valor));
            }}
          >
            <option value="todas">Todas as lojas</option>
            <option value="minhas">Minhas lojas</option>
            {[...lojasDisponiveis.entries()].map(([id, nome]) => (
              <option key={id} value={id}>
                {nome}
              </option>
            ))}
          </select>
          <span className="perguntas-contagem">{perguntasFiltradas.length} aguardando resposta</span>
        </div>
      </div>

      {grupos.length === 0 && <div className="state-message">Nenhuma pergunta pendente. Tudo em dia!</div>}

      {grupos.map((grupo) => (
        <section className="perguntas-grupo" key={grupo.lojaId}>
          <div className="perguntas-grupo-titulo">
            <i className="ranking-dot" style={{ background: corDaLoja(grupo.lojaId) }} />
            <h2>{grupo.lojaNome}</h2>
            <span className="perguntas-grupo-contagem">{grupo.itens.length}</span>
          </div>
          <div className="perguntas-lista">
            {grupo.itens.map((p) => (
              <PerguntaCard key={p.id} pergunta={p} onResponder={responder} onExcluir={excluir} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
