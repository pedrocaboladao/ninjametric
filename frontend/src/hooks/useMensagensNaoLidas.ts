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
  // null = ainda não carregou nenhuma vez — não notifica na primeira leitura
  // (senão todo mundo que já tinha mensagem não lida de antes toma uma
  // notificação assim que abre o painel, mesmo sem nada ter chegado agora).
  const anteriorRef = useRef<number | null>(null);

  const carregar = useCallback(async () => {
    try {
      const novoTotal = await fetchNaoLidas();
      if (
        anteriorRef.current !== null &&
        novoTotal > anteriorRef.current &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        const notificacao = new Notification("Nova mensagem no painel", {
          body: "Você recebeu uma nova mensagem em Mensagens.",
        });
        notificacao.onclick = () => window.focus();
      }
      anteriorRef.current = novoTotal;
      setTotal(novoTotal);
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
