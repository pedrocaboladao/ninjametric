import { useCallback, useEffect, useRef, useState } from "react";
import { fetchNaoLidas } from "../api/mensagens";

// Badge do sidebar — precisa continuar contando mesmo fora da tela de
// Mensagens, por isso mora aqui (polling próprio) e não dentro do
// componente da tela. Intervalo mais curto que o de Perguntas (2min): chat
// pede uma resposta mais perto de "tempo real" sem precisar de WebSocket.
const POLL_INTERVAL_MS = 15 * 1000;

export function useMensagensNaoLidas(ativo = true) {
  const [total, setTotal] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const carregar = useCallback(async () => {
    try {
      setTotal(await fetchNaoLidas());
    } catch {
      // silencioso — não vale mostrar erro só pelo badge falhar uma rodada
    }
  }, []);

  useEffect(() => {
    if (!ativo) return;
    carregar();
    timerRef.current = setInterval(carregar, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [carregar, ativo]);

  return { total, atualizar: carregar };
}
