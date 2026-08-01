import { useEffect, useRef, useState } from "react";
import { fetchVideosRecentes, fetchCanais, adicionarCanal, removerCanal } from "../api/youtube";
import type { VideoRecente, CanalYoutube } from "../types/youtube";

// A API oficial do YouTube (sem pacote de tipos instalado) — só o mínimo
// usado aqui pra criar o player e escutar quando um vídeo termina.
interface YouTubePlayer {
  loadVideoById(videoId: string): void;
  destroy(): void;
}
declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement, options: Record<string, unknown>) => YouTubePlayer;
      PlayerState: { ENDED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

function carregarApiYoutube(aoCarregar: () => void) {
  if (window.YT?.Player) {
    aoCarregar();
    return;
  }
  const anterior = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    anterior?.();
    aoCarregar();
  };
  if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  }
}

// Se a API do YouTube não carregar em alguns segundos (bloqueador de
// anúncios, script travado etc.), cai num revezamento por tempo fixo em vez
// de deixar o painel travado sem trocar de vídeo nunca.
const TIMEOUT_API_MS = 6000;
const INTERVALO_FALLBACK_MS = 90 * 1000;

export function PainelEstudo() {
  const [videos, setVideos] = useState<VideoRecente[] | null>(null);
  const [canais, setCanais] = useState<CanalYoutube[]>([]);
  const [gerenciando, setGerenciando] = useState(false);
  const [novoUrl, setNovoUrl] = useState("");
  const [adicionando, setAdicionando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [indiceAtual, setIndiceAtual] = useState(0);
  const [apiFalhou, setApiFalhou] = useState(false);

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

  // Refs pra o handler do player (registrado uma única vez na criação)
  // sempre enxergar a lista/posição mais recentes.
  const videosOrdenadosRef = useRef(videosOrdenados);
  videosOrdenadosRef.current = videosOrdenados;

  function avancarVideo() {
    const lista = videosOrdenadosRef.current;
    if (!lista || lista.length === 0) return;
    setIndiceAtual((i) => (i + 1) % lista.length);
  }

  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);

  // Cria o player oficial do YouTube uma única vez (assim que tiver o
  // primeiro vídeo) — é o que permite detectar quando o vídeo termina
  // (onStateChange) e só então revezar pro próximo. Se a API não carregar a
  // tempo ou falhar ao criar, cai no modo de revezamento por timer.
  useEffect(() => {
    if (!videoTocando || apiFalhou || playerRef.current || !containerRef.current) return;
    let cancelado = false;
    const timeoutId = setTimeout(() => {
      if (!cancelado && !playerRef.current) setApiFalhou(true);
    }, TIMEOUT_API_MS);

    carregarApiYoutube(() => {
      if (cancelado || playerRef.current || !containerRef.current) return;
      try {
        playerRef.current = new window.YT!.Player(containerRef.current, {
          videoId: videoTocando.videoId,
          playerVars: { autoplay: 1 },
          events: {
            onStateChange: (e: { data: number }) => {
              if (e.data === window.YT!.PlayerState.ENDED) avancarVideo();
            },
          },
        });
        clearTimeout(timeoutId);
      } catch {
        setApiFalhou(true);
      }
    });

    return () => {
      cancelado = true;
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoTocando !== null, apiFalhou]);

  // Vídeo mudou (fim automático ou clique manual): troca só o vídeo
  // carregado no player já existente, sem recriar.
  useEffect(() => {
    if (!videoTocando || !playerRef.current) return;
    try {
      playerRef.current.loadVideoById(videoTocando.videoId);
    } catch {
      setApiFalhou(true);
    }
  }, [videoTocando?.videoId]);

  useEffect(() => {
    return () => {
      try {
        playerRef.current?.destroy();
      } catch {
        // ignora — componente já está desmontando
      }
    };
  }, []);

  // Modo de segurança: só entra em ação se a API do player não funcionou.
  useEffect(() => {
    if (!apiFalhou || !videosOrdenados || videosOrdenados.length < 2) return;
    const timer = setInterval(() => {
      setIndiceAtual((i) => (i + 1) % videosOrdenados.length);
    }, INTERVALO_FALLBACK_MS);
    return () => clearInterval(timer);
  }, [apiFalhou, videosOrdenados?.length]);

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
          {videosOrdenados && videosOrdenados.length > 0 && (
            <div className="painel-estudo-player">
              {apiFalhou ? (
                <iframe
                  key={videoTocando?.videoId}
                  src={`https://www.youtube.com/embed/${videoTocando?.videoId}?autoplay=1`}
                  title={videoTocando?.titulo}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <div ref={containerRef} />
              )}
            </div>
          )}
          {videoTocando && (
            <>
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
