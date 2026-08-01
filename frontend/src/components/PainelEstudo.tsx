import { useEffect, useRef, useState } from "react";
import { fetchVideosRecentes, fetchCanais, adicionarCanal, removerCanal } from "../api/youtube";
import type { VideoRecente, CanalYoutube } from "../types/youtube";

const IFRAME_ID = "painel-estudo-yt-iframe";

export function PainelEstudo() {
  const [videos, setVideos] = useState<VideoRecente[] | null>(null);
  const [canais, setCanais] = useState<CanalYoutube[]>([]);
  const [gerenciando, setGerenciando] = useState(false);
  const [novoUrl, setNovoUrl] = useState("");
  const [adicionando, setAdicionando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [indiceAtual, setIndiceAtual] = useState(0);

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

  const videosOrdenados = videos
    ? [...videos].sort((a, b) => new Date(b.publicadoEm).getTime() - new Date(a.publicadoEm).getTime())
    : null;
  const videoTocando = videosOrdenados?.[indiceAtual] ?? videosOrdenados?.[0] ?? null;
  const restante = videosOrdenados?.filter((_, i) => i !== indiceAtual) ?? [];

  const videosOrdenadosRef = useRef(videosOrdenados);
  videosOrdenadosRef.current = videosOrdenados;

  // Escuta o protocolo de postMessage do próprio embed do YouTube (não
  // precisa carregar nenhum script externo, só o iframe padrão com
  // "enablejsapi=1") pra saber quando o vídeo atual chega ao fim e só então
  // revezar pro próximo — em vez de um timer fixo que cortava vídeos longos
  // no meio.
  useEffect(() => {
    function aoReceberMensagem(evento: MessageEvent) {
      if (evento.origin !== "https://www.youtube.com" || typeof evento.data !== "string") return;
      let dados: { event?: string; info?: unknown };
      try {
        dados = JSON.parse(evento.data);
      } catch {
        return;
      }
      const estado =
        dados.event === "onStateChange"
          ? dados.info
          : dados.event === "infoDelivery" && dados.info && typeof dados.info === "object"
          ? (dados.info as { playerState?: unknown }).playerState
          : undefined;
      if (estado !== 0) return; // 0 = vídeo terminou

      const lista = videosOrdenadosRef.current;
      if (!lista || lista.length === 0) return;
      setIndiceAtual((i) => (i + 1) % lista.length);
    }

    window.addEventListener("message", aoReceberMensagem);
    return () => window.removeEventListener("message", aoReceberMensagem);
  }, []);

  function aoCarregarIframe(e: React.SyntheticEvent<HTMLIFrameElement>) {
    // Handshake do protocolo do YouTube: precisa avisar que está "ouvindo"
    // pra receber os eventos de mudança de estado (infoDelivery).
    e.currentTarget.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: IFRAME_ID }), "*");
  }

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
                  id={IFRAME_ID}
                  key={videoTocando.videoId}
                  src={`https://www.youtube.com/embed/${videoTocando.videoId}?enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`}
                  title={videoTocando.titulo}
                  onLoad={aoCarregarIframe}
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
              onClick={() => {
                const i = videosOrdenados?.findIndex((item) => item.videoId === v.videoId) ?? -1;
                if (i >= 0) setIndiceAtual(i);
              }}
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
