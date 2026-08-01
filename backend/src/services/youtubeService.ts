import axios from "axios";
import { pool } from "../db/pool";

export interface CanalYoutube {
  id: number;
  nome: string;
  channelId: string;
  url: string;
}

function mapRow(r: { id: number; nome: string; channel_id: string; url: string }): CanalYoutube {
  return { id: r.id, nome: r.nome, channelId: r.channel_id, url: r.url };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Aceita link direto de canal (/channel/UC...) ou de handle/nome personalizado
// (/@handle, /c/nome, /user/nome) — nesses últimos casos, busca o channel_id
// real na própria página, que o YouTube embute como "externalId".
async function resolverChannelId(url: string): Promise<string> {
  const direto = url.match(/\/channel\/(UC[a-zA-Z0-9_-]+)/);
  if (direto) return direto[1];

  const { data: html } = await axios.get<string>(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const match = html.match(/"externalId":"(UC[a-zA-Z0-9_-]+)"/);
  if (!match) {
    throw new Error("Não foi possível identificar o canal a partir desse link.");
  }
  return match[1];
}

async function buscarNomeCanal(channelId: string): Promise<string> {
  const { data: xml } = await axios.get<string>(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
  );
  const match = xml.match(/<title>([^<]+)<\/title>/);
  return match ? decodeXmlEntities(match[1]) : channelId;
}

export async function adicionarCanal(url: string): Promise<CanalYoutube> {
  const channelId = await resolverChannelId(url.trim());
  const nome = await buscarNomeCanal(channelId);
  const { rows } = await pool.query(
    `INSERT INTO canais_youtube (nome, channel_id, url) VALUES ($1, $2, $3)
     ON CONFLICT (channel_id) DO UPDATE SET nome = $1, url = $3
     RETURNING id, nome, channel_id, url`,
    [nome, channelId, url.trim()]
  );
  invalidarCache();
  return mapRow(rows[0]);
}

export async function listarCanais(): Promise<CanalYoutube[]> {
  const { rows } = await pool.query("SELECT id, nome, channel_id, url FROM canais_youtube ORDER BY nome");
  return rows.map(mapRow);
}

export async function removerCanal(id: number): Promise<void> {
  await pool.query("DELETE FROM canais_youtube WHERE id = $1", [id]);
  invalidarCache();
}

export interface VideoRecente {
  canalId: number;
  canalNome: string;
  videoId: string;
  titulo: string;
  thumbnail: string;
  publicadoEm: string;
  link: string;
}

// Tentamos filtrar shorts checando a duração real do vídeo (a página
// completa), mas o YouTube serve uma versão da página sem os dados do
// player pra requisições vindas de servidor/datacenter (como o VPS) — sem
// isso embutido no HTML, não dá pra saber a duração de forma confiável a
// partir daqui. Fica então o vídeo mais recente do canal, seja short ou não.
async function buscarUltimoVideo(canal: CanalYoutube): Promise<VideoRecente | null> {
  try {
    const { data: xml } = await axios.get<string>(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${canal.channelId}`
    );
    const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1];
    if (!entry) return null;

    const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const titulo = entry.match(/<title>([^<]+)<\/title>/)?.[1];
    const thumbnail = entry.match(/<media:thumbnail url="([^"]+)"/)?.[1];
    const publicadoEm = entry.match(/<published>([^<]+)<\/published>/)?.[1];
    if (!videoId || !titulo) return null;

    return {
      canalId: canal.id,
      canalNome: canal.nome,
      videoId,
      titulo: decodeXmlEntities(titulo),
      thumbnail: thumbnail ?? "",
      publicadoEm: publicadoEm ?? "",
      link: `https://www.youtube.com/watch?v=${videoId}`,
    };
  } catch {
    return null;
  }
}

// Cache simples: checar o feed RSS de cada canal toda hora é suficiente (não
// é conteúdo que muda a cada minuto) e evita bater no YouTube a cada
// atualização automática do painel.
const CACHE_TTL_MS = 60 * 60 * 1000;
let cache: { data: VideoRecente[]; expiraEm: number } | null = null;

function invalidarCache() {
  cache = null;
}

export async function listarVideosRecentes(): Promise<VideoRecente[]> {
  if (cache && cache.expiraEm > Date.now()) return cache.data;

  const canais = await listarCanais();
  const videos = await Promise.all(canais.map(buscarUltimoVideo));
  const validos = videos.filter((v): v is VideoRecente => v !== null);

  cache = { data: validos, expiraEm: Date.now() + CACHE_TTL_MS };
  return validos;
}
