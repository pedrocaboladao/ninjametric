import { useEffect, useRef, useState } from "react";
import { fetchTopVendidosPromocoes } from "../api/dashboard";
import type { TopVendidoPromocao } from "../types/dashboard";

const POLL_INTERVAL_MS = 5 * 60 * 1000;

export function useTopVendidosPromocoes(lojaId?: number | "minhas") {
  const [produtos, setProdutos] = useState<TopVendidoPromocao[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      setAtualizando(true);
      try {
        const result = await fetchTopVendidosPromocoes(lojaId);
        if (!cancelled) {
          setProdutos(result);
          setError(null);
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

  return { produtos, error, loading, atualizando };
}
