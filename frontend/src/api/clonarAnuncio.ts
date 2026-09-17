import type { PreviewAnuncio, ResultadoClone } from "../types/clonarAnuncio";
import type { Loja } from "./lojas";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function tratarErro(res: Response): Promise<never> {
  const data = await res.json().catch(() => null);
  throw new Error(data?.error ?? `Erro ${res.status}`);
}

export async function fetchLojas(): Promise<Loja[]> {
  const res = await fetch(`${API_BASE}/api/clonar-anuncio/lojas`, { credentials: "include" });
  if (!res.ok) return tratarErro(res);
  const data = await res.json();
  return data.lojas;
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
  titulos: string[];
  listingType: string;
  ativarFlex: boolean;
  imagensPersonalizadas?: string[];
  imagensPorVariacao?: Record<number, string[]>;
  vincularCatalogo?: boolean;
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

// Baixa o vídeo do YouTube anexado ao anúncio (campo video_id) — dispara o
// download no navegador, mesmo padrão de fabricaProdutos.ts (blob + link
// temporário), já que o nome do arquivo real vem só no header da resposta.
export async function baixarVideoAnuncio(url: string): Promise<void> {
  const params = new URLSearchParams({ url });
  const res = await fetch(`${API_BASE}/api/clonar-anuncio/video?${params}`, { credentials: "include" });
  if (!res.ok) return tratarErro(res);
  const nome =
    res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "video.mp4";
  const blobUrl = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
}
