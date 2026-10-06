import { useCallback, useEffect, useState } from "react";
import type { AvisoAgenda } from "../types/agenda";
import { fetchAvisosAgenda, publicarAvisoAgenda, excluirAvisoAgenda } from "../api/agenda";
import { formatDataHora } from "../utils/format";

export function AgendaMural() {
  const [avisos, setAvisos] = useState<AvisoAgenda[] | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setAvisos(await fetchAvisosAgenda());
      setErro(null);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao carregar o mural.");
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function publicar() {
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      await publicarAvisoAgenda(texto.trim());
      setTexto("");
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao publicar o aviso.");
    } finally {
      setEnviando(false);
    }
  }

  async function excluir(aviso: AvisoAgenda) {
    if (!window.confirm("Apagar esse aviso?")) return;
    try {
      await excluirAvisoAgenda(aviso.id);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao apagar o aviso.");
    }
  }

  return (
    <div className="agenda-mural">
      <div className="agenda-mural-novo">
        <textarea
          className="clonar-input"
          placeholder="Escreva um aviso pro outro..."
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={3}
        />
        <button type="button" className="btn-responder" onClick={publicar} disabled={enviando || !texto.trim()}>
          {enviando ? "Publicando..." : "Publicar aviso"}
        </button>
      </div>

      {erro && <div className="clonar-erro">{erro}</div>}
      {avisos === null && !erro && <div className="state-message">Carregando...</div>}
      {avisos && (
        <div className="agenda-mural-colunas">
          {[
            { titulo: "Meus avisos", itens: avisos.filter((a) => a.podeExcluir) },
            { titulo: "Avisos do Brunão", itens: avisos.filter((a) => !a.podeExcluir) },
          ].map((coluna) => (
            <div key={coluna.titulo} className="agenda-mural-coluna">
              <div className="agenda-mural-coluna-titulo">{coluna.titulo}</div>
              {coluna.itens.length === 0 && <div className="financeiro-td-mudo">Nenhum aviso ainda.</div>}
              {coluna.itens.map((aviso) => (
                <div key={aviso.id} className="agenda-mural-aviso">
                  <div className="agenda-mural-aviso-topo">
                    <span className="agenda-relatorio-data">{formatDataHora(aviso.criadoEm)}</span>
                    {aviso.podeExcluir && (
                      <button type="button" className="agenda-relatorio-excluir" onClick={() => excluir(aviso)} title="Apagar">
                        ×
                      </button>
                    )}
                  </div>
                  <div className="agenda-mural-aviso-texto">{aviso.texto}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
