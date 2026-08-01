import { useEffect, useState } from "react";
import { fetchVideosRecentes, fetchCanais, adicionarCanal, removerCanal } from "../api/youtube";
import type { VideoRecente, CanalYoutube } from "../types/youtube";

export function PainelEstudo() {
  const [videos, setVideos] = useState<VideoRecente[] | null>(null);
  const [canais, setCanais] = useState<CanalYoutube[]>([]);
  const [gerenciando, setGerenciando] = useState(false);
  const [novoUrl, setNovoUrl] = useState("");
  const [adicionando, setAdicionando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    try {
      const [v, c] = await Promise.all([fetchVideosRecentes(), fetchCanais()]);
      setVideos(v);
      setCanais(c);
    } catch {
      setVideos((atual) => atual ?? []);
    }
  }

  useEffect(() => {
    carregar();
    const timer = setInterval(carregar, 30 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  async function handleAdicionar(e: React.FormEvent) {
    e.preventDefault();
    if (!novoUrl.trim() || adicionando) return;
    setAdicionando(true);
    setErro(null);
    try {
      await adicionarCanal(novoUrl.trim());
      setNovoUrl("");
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao adicionar canal.");
    } finally {
      setAdicionando(false);
    }
  }

  async function handleRemover(id: number) {
    await removerCanal(id);
    await carregar();
  }

  return (
    <div className="painel painel-estudo">
      <div className="painel-estudo-header">
        <div>
          <span className="painel-eyebrow">Painel de estudo</span>
          <h2>Últimos vídeos</h2>
        </div>
        <button className="painel-estudo-gerenciar-btn" onClick={() => setGerenciando((g) => !g)} type="button">
          {gerenciando ? "Concluído" : "Gerenciar canais"}
        </button>
      </div>

      {gerenciando ? (
        <div className="painel-estudo-gerenciar">
          <form onSubmit={handleAdicionar} className="painel-estudo-add-form">
            <input
              className="clonar-input"
              placeholder="Link do canal (ex.: youtube.com/@canal)"
              value={novoUrl}
              onChange={(e) => setNovoUrl(e.target.value)}
            />
            <button className="btn-responder" type="submit" disabled={adicionando}>
              {adicionando ? "Adicionando..." : "Adicionar"}
            </button>
          </form>
          {erro && <div className="state-message state-error painel-estudo-erro">{erro}</div>}
          <div className="painel-estudo-canais-lista">
            {canais.map((c) => (
              <div key={c.id} className="painel-estudo-canal-item">
                <span>{c.nome}</span>
                <button className="btn-excluir" onClick={() => handleRemover(c.id)} type="button">
                  Remover
                </button>
              </div>
            ))}
            {canais.length === 0 && <div className="state-message">Nenhum canal adicionado ainda.</div>}
          </div>
        </div>
      ) : (
        <div className="painel-estudo-videos">
          {videos === null && <div className="state-message">Carregando vídeos...</div>}
          {videos?.length === 0 && (
            <div className="state-message">
              Nenhum canal configurado — clique em "Gerenciar canais" pra adicionar o primeiro.
            </div>
          )}
          {videos?.map((v) => (
            <a key={v.videoId} className="painel-estudo-video-item" href={v.link} target="_blank" rel="noreferrer">
              {v.thumbnail ? (
                <img className="painel-estudo-thumb" src={v.thumbnail} alt="" loading="lazy" />
              ) : (
                <div className="painel-estudo-thumb painel-estudo-thumb-vazia" />
              )}
              <div className="painel-estudo-video-info">
                <div className="painel-estudo-video-titulo" title={v.titulo}>
                  {v.titulo}
                </div>
                <div className="painel-estudo-video-canal">{v.canalNome}</div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
