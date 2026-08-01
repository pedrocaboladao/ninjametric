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
  const [videoSelecionadoId, setVideoSelecionadoId] = useState<string | null>(null);

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

  const videosOrdenados = videos
    ? [...videos].sort((a, b) => new Date(b.publicadoEm).getTime() - new Date(a.publicadoEm).getTime())
    : null;

  const videoTocando =
    videosOrdenados?.find((v) => v.videoId === videoSelecionadoId) ?? videosOrdenados?.[0] ?? null;
  const restante = videosOrdenados?.filter((v) => v.videoId !== videoTocando?.videoId) ?? [];

  return (
    <div className="painel painel-estudo">
      <div className="painel-estudo-header">
        <div>
          <span className="painel-eyebrow">Impetrus TV</span>
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
          {videoTocando && (
            <>
              <div className="painel-estudo-player">
                <iframe
                  key={videoTocando.videoId}
                  src={`https://www.youtube.com/embed/${videoTocando.videoId}?autoplay=1`}
                  title={videoTocando.titulo}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
              <div className="painel-estudo-player-titulo" title={videoTocando.titulo}>
                {videoTocando.titulo}
              </div>
              <div className="painel-estudo-player-canal">{videoTocando.canalNome}</div>
            </>
          )}
          {restante.map((v) => (
            <button
              key={v.videoId}
              className="painel-estudo-video-item"
              onClick={() => setVideoSelecionadoId(v.videoId)}
              type="button"
            >
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
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
