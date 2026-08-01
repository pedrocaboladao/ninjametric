import type { CanalYoutube, VideoRecente } from "../types/youtube";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function tratarErro(res: Response): Promise<never> {
  const data = await res.json().catch(() => null);
  throw new Error(data?.error ?? `Erro ${res.status}`);
}

export async function fetchCanais(): Promise<CanalYoutube[]> {
  const res = await fetch(`${API_BASE}/api/youtube/canais`, { credentials: "include" });
  if (!res.ok) return tratarErro(res);
  const data = await res.json();
  return data.canais;
}

export async function adicionarCanal(url: string): Promise<CanalYoutube> {
  const res = await fetch(`${API_BASE}/api/youtube/canais`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) return tratarErro(res);
  const data = await res.json();
  return data.canal;
}

export async function removerCanal(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/youtube/canais/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) return tratarErro(res);
}

export async function fetchVideosRecentes(): Promise<VideoRecente[]> {
  const res = await fetch(`${API_BASE}/api/youtube/videos`, { credentials: "include" });
  if (!res.ok) return tratarErro(res);
  const data = await res.json();
  return data.videos;
}
