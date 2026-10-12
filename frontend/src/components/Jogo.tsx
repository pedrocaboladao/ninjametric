import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSemanaJogo, registrarTentativaJogo } from "../api/jogo";
import type { SemanaJogo } from "../types/jogo";
import { IconCrown } from "./icons";
import "./Jogo.css";

const LARGURA = 320;
const ALTURA = 420;
const GRAVIDADE = 0.38;
const IMPULSO = -6.4;
const VELOCIDADE_CANO = 2.3;
const INTERVALO_CANOS = 95;
const VAO_CANO = 130;
const LARGURA_CANO = 42;

interface Pipe {
  x: number;
  topo: number;
  base: number;
  contado: boolean;
}

interface EstadoJogo {
  bird: { x: number; y: number; vy: number; raio: number };
  pipes: Pipe[];
  frame: number;
  score: number;
  rodando: boolean;
  rafId: number | null;
}

type Fase = "carregando" | "jogando" | "parado";

// Flappy Ninja: 1 botão (clique/espaço) pra voar entre os obstáculos.
// Pontuação = obstáculos passados. Loop do jogo roda fora do ciclo de render
// do React (estado mutável num ref), só setState pra UI visível (fase,
// pontuação, ranking) — senão cada frame re-renderia a árvore inteira.
export function Jogo() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const estadoRef = useRef<EstadoJogo | null>(null);

  const [semana, setSemana] = useState<SemanaJogo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [fase, setFase] = useState<Fase>("carregando");
  const [pontuacaoFinal, setPontuacaoFinal] = useState<number | null>(null);
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const s = await fetchSemanaJogo();
      setSemana(s);
      setFase("parado");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao carregar o jogo.");
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(
    () => () => {
      if (estadoRef.current?.rafId !== null && estadoRef.current?.rafId !== undefined) {
        cancelAnimationFrame(estadoRef.current.rafId);
      }
    },
    []
  );

  function desenharBird(ctx: CanvasRenderingContext2D, bird: EstadoJogo["bird"]) {
    const ang = Math.max(-0.5, Math.min(0.9, bird.vy / 10));
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(ang);
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.arc(0, 0, bird.raio, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#22d3ee";
    ctx.beginPath();
    ctx.moveTo(-bird.raio, 0);
    ctx.lineTo(-bird.raio - 9, -6);
    ctx.lineTo(-bird.raio - 9, 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#05070d";
    ctx.beginPath();
    ctx.arc(5, -3, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function desenharPipe(ctx: CanvasRenderingContext2D, p: Pipe) {
    ctx.fillStyle = "#17243a";
    ctx.strokeStyle = "rgba(56,189,248,0.4)";
    ctx.lineWidth = 1.5;
    ctx.fillRect(p.x, 0, LARGURA_CANO, p.topo);
    ctx.strokeRect(p.x, 0, LARGURA_CANO, p.topo);
    ctx.fillRect(p.x, p.base, LARGURA_CANO, ALTURA - p.base);
    ctx.strokeRect(p.x, p.base, LARGURA_CANO, ALTURA - p.base);
  }

  async function finalizar(score: number) {
    setPontuacaoFinal(score);
    setFase("parado");
    setEnviando(true);
    setErro(null);
    try {
      setSemana(await registrarTentativaJogo(score));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao registrar a tentativa.");
    } finally {
      setEnviando(false);
    }
  }

  function loop() {
    const e = estadoRef.current;
    const canvas = canvasRef.current;
    if (!e || !e.rodando || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    e.frame++;
    e.bird.vy += GRAVIDADE;
    e.bird.y += e.bird.vy;

    if (e.frame % INTERVALO_CANOS === 0) {
      const margem = 50;
      const centro = margem + Math.random() * (ALTURA - margem * 2 - VAO_CANO) + VAO_CANO / 2;
      e.pipes.push({ x: LARGURA + 20, topo: centro - VAO_CANO / 2, base: centro + VAO_CANO / 2, contado: false });
    }
    e.pipes.forEach((p) => {
      p.x -= VELOCIDADE_CANO;
    });
    e.pipes = e.pipes.filter((p) => p.x + LARGURA_CANO > -5);

    let terminou = false;
    e.pipes.forEach((p) => {
      if (!p.contado && p.x + LARGURA_CANO < e.bird.x) {
        p.contado = true;
        e.score++;
      }
      const dentroX = e.bird.x + e.bird.raio > p.x && e.bird.x - e.bird.raio < p.x + LARGURA_CANO;
      if (dentroX && (e.bird.y - e.bird.raio < p.topo || e.bird.y + e.bird.raio > p.base)) terminou = true;
    });
    if (e.bird.y + e.bird.raio > ALTURA || e.bird.y - e.bird.raio < 0) terminou = true;

    ctx.clearRect(0, 0, LARGURA, ALTURA);
    e.pipes.forEach((p) => desenharPipe(ctx, p));
    desenharBird(ctx, e.bird);
    ctx.fillStyle = "#f4f6fb";
    ctx.font = "600 20px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(e.score), LARGURA / 2, 36);

    if (terminou) {
      e.rodando = false;
      finalizar(e.score);
      return;
    }
    e.rafId = requestAnimationFrame(loop);
  }

  function iniciarJogo() {
    if (!semana || semana.tentativasUsadas >= semana.tentativasMaximas) return;
    estadoRef.current = {
      bird: { x: 70, y: ALTURA / 2, vy: 0, raio: 11 },
      pipes: [],
      frame: 0,
      score: 0,
      rodando: true,
      rafId: null,
    };
    setPontuacaoFinal(null);
    setErro(null);
    setFase("jogando");
    loop();
  }

  function flap() {
    const e = estadoRef.current;
    if (!e || !e.rodando) return;
    e.bird.vy = IMPULSO;
  }

  useEffect(() => {
    function aoTeclar(ev: KeyboardEvent) {
      if (ev.code === "Space") {
        ev.preventDefault();
        flap();
      }
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  const esgotado = !!semana && semana.tentativasUsadas >= semana.tentativasMaximas;
  const ranking = semana?.ranking ?? [];

  return (
    <div className="jogo-page">
      <div className="tarefas-topo">
        <span className="painel-eyebrow">Jogo da semana</span>
        <h1>
          <span className="jogo-titulo-icone">
            <IconCrown size={24} />
          </span>
          Flappy Ninja
        </h1>
        <p className="painel-sub">
          Clique ou aperte espaço pra voar entre os obstáculos.
          {semana && !esgotado ? ` ${semana.tentativasMaximas - semana.tentativasUsadas} tentativa(s) restante(s) essa semana.` : ""}
        </p>
      </div>

      {erro && <div className="clonar-erro">{erro}</div>}
      {fase === "carregando" && <div className="state-message">Carregando...</div>}

      {semana && fase !== "carregando" && (
        <div className="jogo-corpo">
          <div className="jogo-tela">
            <canvas
              ref={canvasRef}
              width={LARGURA}
              height={ALTURA}
              className="jogo-canvas"
              onClick={() => (fase === "jogando" ? flap() : undefined)}
            />
            {fase === "parado" && (
              <div className="jogo-overlay">
                {esgotado ? (
                  <>
                    <div className="jogo-overlay-titulo">
                      {pontuacaoFinal !== null ? `Pontuação: ${pontuacaoFinal}` : "Sem tentativas"}
                    </div>
                    <div className="jogo-overlay-texto">Tentativas da semana acabaram. Volta semana que vem pra tentar de novo.</div>
                  </>
                ) : pontuacaoFinal !== null ? (
                  <>
                    <div className="jogo-overlay-titulo">Pontuação: {pontuacaoFinal}</div>
                    <div className="jogo-overlay-texto">
                      {enviando ? "Registrando..." : `Ainda sobrou ${semana.tentativasMaximas - semana.tentativasUsadas} tentativa(s) essa semana.`}
                    </div>
                    {!enviando && (
                      <button type="button" className="btn-responder" onClick={iniciarJogo}>
                        Jogar de novo
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <div className="jogo-overlay-titulo">Pronto pra tentar?</div>
                    <div className="jogo-overlay-texto">Clique no jogo ou aperte espaço pra começar a voar.</div>
                    <button type="button" className="btn-responder" onClick={iniciarJogo}>
                      Jogar
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="jogo-ranking">
            <div className="jogo-ranking-topo">
              <IconCrown size={16} />
              <span>Ranking da semana</span>
            </div>
            {ranking.length === 0 && <div className="financeiro-td-mudo">Ninguém jogou essa semana ainda.</div>}
            {ranking.map((r, i) => (
              <div key={r.usuarioId} className={`jogo-ranking-linha ${r.eu ? "jogo-ranking-linha-eu" : ""}`}>
                <span className="jogo-ranking-posicao">{i + 1}º</span>
                <span className="jogo-ranking-nome">{r.nome}</span>
                <span className="jogo-ranking-pontos">{r.pontuacao}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
