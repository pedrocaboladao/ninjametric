import { PerguntaCard } from "./PerguntaCard";
import { corDaLoja } from "../utils/format";
import type { PerguntaPendente } from "../types/perguntas";

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
  responder: (lojaId: number, questionId: number, texto: string) => Promise<void>;
  excluir: (lojaId: number, questionId: number) => Promise<void>;
}

export function Perguntas({ perguntas, error, loading, responder, excluir }: Props) {
  if (loading) {
    return <div className="state-message">Carregando perguntas...</div>;
  }

  if (error) {
    return <div className="state-message state-error">Erro ao carregar perguntas: {error}</div>;
  }

  if (!perguntas) {
    return null;
  }

  const grupos = agruparPorLoja(perguntas);

  return (
    <div className="perguntas">
      <div className="perguntas-header">
        <div>
          <h1>Perguntas</h1>
          <p className="painel-sub">Centralize e responda as perguntas das 4 contas sem entrar em cada uma.</p>
        </div>
        <span className="perguntas-contagem">{perguntas.length} aguardando resposta</span>
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
