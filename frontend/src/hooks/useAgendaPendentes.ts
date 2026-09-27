import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAgendaPendentes } from "../api/agenda";

// Menos urgente que o Chat (não é conversa em tempo real) — 60s é suficiente
// pra avisar de uma tarefa vencida sem ficar batendo no servidor à toa.
const POLL_INTERVAL_MS = 60 * 1000;

export function useAgendaPendentes(ativo = true) {
  const [total, setTotal] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const anteriorRef = useRef<number | null>(null);

  const carregar = useCallback(async () => {
    try {
      const novoTotal = await fetchAgendaPendentes();
      if (
        anteriorRef.current !== null &&
        novoTotal > anteriorRef.current &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        const notificacao = new Notification("Tarefa da Agenda vencendo", {
          body: "Há uma tarefa recorrente pendente na Agenda.",
        });
        notificacao.onclick = () => window.focus();
      }
      anteriorRef.current = novoTotal;
      setTotal(novoTotal);
    } catch {
      // silencioso
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
