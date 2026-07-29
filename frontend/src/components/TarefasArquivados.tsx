import type { CartaoArquivado, Coluna } from "../types/tarefas";

interface Props {
  cartoes: CartaoArquivado[];
  colunas: Coluna[];
  onRestaurar: (id: number, colunaId: number) => void;
}

export function TarefasArquivados({ cartoes, colunas, onRestaurar }: Props) {
  if (cartoes.length === 0) {
    return <div className="state-message">Nenhum cartão arquivado.</div>;
  }

  return (
    <div className="tarefa-arquivados-lista">
      {cartoes.map((c) => (
        <div key={c.id} className="tarefa-arquivado-item">
          <div>
            <div className="tarefa-arquivado-titulo">{c.titulo}</div>
            <div className="tarefa-arquivado-origem">Coluna original: {c.colunaNomeOriginal}</div>
          </div>
          <select
            className="clonar-input tarefa-arquivado-select"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) onRestaurar(c.id, Number(e.target.value));
            }}
          >
            <option value="" disabled>
              Restaurar para...
            </option>
            {colunas.map((col) => (
              <option key={col.id} value={col.id}>
                {col.nome}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}
