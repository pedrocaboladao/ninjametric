import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPerguntas, responderPergunta, excluirPergunta } from "../api/perguntas";
import type { PerguntaPendente } from "../types/perguntas";

const POLL_INTERVAL_MS = 2 * 60 * 1000;

export function usePerguntas(ativo = true) {
  const [perguntas, setPerguntas] = useState<PerguntaPendente[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const carregar = useCallback(async () => {
    try {
      const result = await fetchPerguntas();
      setPerguntas(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ativo) {
      setLoading(false);
      return;
    }
    carregar();
    timerRef.current = setInterval(carregar, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [carregar, ativo]);

  async function responder(lojaId: number, questionId: number, texto: string) {
    await responderPergunta(lojaId, questionId, texto);
    setPerguntas((atual) => atual?.filter((p) => p.id !== questionId) ?? atual);
  }

  async function excluir(lojaId: number, questionId: number) {
    await excluirPergunta(lojaId, questionId);
    setPerguntas((atual) => atual?.filter((p) => p.id !== questionId) ?? atual);
  }

  return { perguntas, error, loading, responder, excluir, recarregar: carregar };
}
