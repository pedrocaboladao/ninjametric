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
  tipo: "short" | "video";
}

interface EntradaFeed {
  videoId: string;
  titulo: string;
  thumbnail: string;
  publicadoEm: string;
}

function parseEntradasFeed(xml: string): EntradaFeed[] {
  const blocos = xml.match(/<entry>([\s\S]*?)<\/entry>/g) ?? [];
  return blocos
    .map((bloco) => ({
      videoId: bloco.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1] ?? "",
      titulo: decodeXmlEntities(bloco.match(/<title>([^<]+)<\/title>/)?.[1] ?? ""),
      thumbnail: bloco.match(/<media:thumbnail url="([^"]+)"/)?.[1] ?? "",
      publicadoEm: bloco.match(/<published>([^<]+)<\/published>/)?.[1] ?? "",
    }))
    .filter((e) => e.videoId && e.titulo);
}

// O próprio YouTube considera Short qualquer vídeo de até 3 minutos.
const LIMITE_SHORT_SEGUNDOS = 180;

// O feed RSS não informa a duração do vídeo — só dá pra saber lendo a
// página de fato (o player embute "lengthSeconds" no HTML).
async function buscarDuracaoSegundos(videoId: string): Promise<number | null> {
  try {
    const { data: html } = await axios.get<string>(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const duracao = html.match(/"lengthSeconds":"(\d+)"/)?.[1];
    return duracao ? Number(duracao) : null;
  } catch {
    return null;
  }
}

// Canais costumam postar shorts com muito mais frequência que vídeos
// longos — pegando só o vídeo mais recente no geral, o long quase nunca
// aparece (fica sempre atrás de shorts mais novos). Por isso busca os dois
// separadamente: o short mais recente E o vídeo longo mais recente, parando
// assim que achar os dois (early exit, sem varrer o feed inteiro à toa).
async function buscarVideosCanal(canal: CanalYoutube): Promise<VideoRecente[]> {
  try {
    const { data: xml } = await axios.get<string>(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${canal.channelId}`
    );
    const entradas = parseEntradasFeed(xml);

    let short: VideoRecente | null = null;
    let longo: VideoRecente | null = null;

    for (const entrada of entradas) {
      if (short && longo) break;
      const duracaoSegundos = await buscarDuracaoSegundos(entrada.videoId);
      if (duracaoSegundos === null) continue;

      const video: VideoRecente = {
        canalId: canal.id,
        canalNome: canal.nome,
        videoId: entrada.videoId,
        titulo: entrada.titulo,
        thumbnail: entrada.thumbnail,
        publicadoEm: entrada.publicadoEm,
        link: `https://www.youtube.com/watch?v=${entrada.videoId}`,
        tipo: duracaoSegundos <= LIMITE_SHORT_SEGUNDOS ? "short" : "video",
      };

      if (video.tipo === "short" && !short) short = video;
      if (video.tipo === "video" && !longo) longo = video;
    }

    return [short, longo].filter((v): v is VideoRecente => v !== null);
  } catch {
    return [];
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
  const videosPorCanal = await Promise.all(canais.map(buscarVideosCanal));
  const todos = videosPorCanal.flat();

  cache = { data: todos, expiraEm: Date.now() + CACHE_TTL_MS };
  return todos;
}
