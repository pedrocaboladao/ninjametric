import type { PreviewAnuncio, ResultadoClone } from "../types/clonarAnuncio";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export { fetchLojas } from "./lojas";

async function tratarErro(res: Response): Promise<never> {
  const data = await res.json().catch(() => null);
  throw new Error(data?.error ?? `Erro ${res.status}`);
}

export async function buscarPreview(url: string, lojaDestinoId: number): Promise<PreviewAnuncio> {
  const res = await fetch(`${API_BASE}/api/clonar-anuncio/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ url, lojaDestinoId }),
  });
  if (!res.ok) return tratarErro(res);
  return res.json();
}

export interface PublicarParams {
  url: string;
  lojaDestinoId: number;
  tituloFinal: string;
  listingType: string;
  ativarFlex: boolean;
  quantidadeClones: number;
  imagensPersonalizadas?: string[];
  imagensPorVariacao?: Record<number, string[]>;
}

export async function publicarClone(params: PublicarParams): Promise<ResultadoClone[]> {
  const res = await fetch(`${API_BASE}/api/clonar-anuncio/publicar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });
  if (!res.ok) return tratarErro(res);
  const data = await res.json();
  return data.resultados;
}
