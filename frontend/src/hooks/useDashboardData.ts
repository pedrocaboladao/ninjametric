import { useEffect, useRef, useState } from "react";
import { fetchDashboardData } from "../api/dashboard";
import type { DashboardData } from "../types/dashboard";

const POLL_INTERVAL_MS = 2 * 60 * 1000;

export function useDashboardData(lojaId?: number | "minhas") {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      setAtualizando(true);
      try {
        const result = await fetchDashboardData(lojaId);
        if (!cancelled) {
          setData(result);
          setError(null);
          setAtualizadoEm(new Date());
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Erro desconhecido");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setAtualizando(false);
        }
      }
    }

    load();
    timerRef.current = setInterval(load, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [lojaId]);

  return { data, error, loading, atualizando, atualizadoEm };
}
