import { Router } from "express";
import { spawn } from "child_process";
import ytdl from "@distube/ytdl-core";
import { montarPreview, publicarClone, resolverVideoDoAnuncio } from "../services/clonarAnuncioService";
import { temAcessoLojaParaClonagem, lojasEfetivasParaClonagem } from "../services/usuariosService";
import { listLojas } from "../services/tokenStore";
import { extrairItemIdDaUrl, getItemFullComToken, resolverItemIdPorUserProduct } from "../services/mercadoLivreItems";
import axios from "axios";
import { consultarPromocoesDoItem } from "../services/mercadoLivreApi";
import { getValidAccessToken } from "../services/tokenStore";

export const clonarAnuncioRouter = Router();

// Lista de lojas disponíveis como destino do clone — usa a regra específica de
// clonagem (temAcessoLojaParaClonagem), que pode ser mais ampla que a lista
// geral de "lojas com acesso" usada pelo Dashboard/Perguntas.
clonarAnuncioRouter.get("/lojas", async (req, res) => {
  try {
    const usuario = req.usuario!;
    const lojas = (await listLojas()).filter(
      (l) => l.ml_user_id !== null && temAcessoLojaParaClonagem(usuario, l.id)
    );
    res.json({ lojas: lojas.map((l) => ({ id: l.id, nome: l.nome })) });
  } catch (err) {
    console.error("Erro ao listar lojas para clonagem:", err);
    res.status(500).json({ error: "Falha ao listar lojas." });
  }
});

// Diagnóstico temporário — pra investigar por que anúncio de catálogo dá
// "não pertence a nenhuma das suas lojas" mesmo quando a loja dona tem
// clonagem normal funcionando. encontrarLojaDonaEItem (privada, não
// exportada) engole qualquer erro por loja silenciosamente — aqui testamos
// TODAS as lojas com token e devolvemos o erro real de cada uma, sem
// esconder nada. Remover depois.
clonarAnuncioRouter.get("/item-diag", async (req, res) => {
  const url = typeof req.query.url === "string" ? req.query.url : "";
  if (!url) {
    res.status(400).json({ error: "Informe ?url=<link ou MLB do anúncio>" });
    return;
  }
  try {
    const identificador = await extrairItemIdDaUrl(url);
    const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null);
    const resultados = await Promise.all(
      lojas.map(async (loja) => {
        try {
          let itemId = identificador.id;
          if (identificador.tipo === "user_product") {
            const resolvido = await resolverItemIdPorUserProduct(loja.id, loja.ml_user_id as number, identificador.id);
            if (!resolvido) return { lojaId: loja.id, lojaNome: loja.nome, ok: false, erro: "user_product não resolveu pra essa loja" };
            itemId = resolvido;
          }
          const item = await getItemFullComToken(loja.id, itemId);
          return {
            lojaId: loja.id,
            lojaNome: loja.nome,
            ok: true,
            titulo: item.title,
            catalogListing: item.catalog_listing ?? null,
            catalogProductId: item.catalog_product_id ?? null,
          };
        } catch (err: any) {
          return {
            lojaId: loja.id,
            lojaNome: loja.nome,
            ok: false,
            status: err?.response?.status ?? null,
            erro: err?.response?.data?.message ?? err?.message ?? String(err),
          };
        }
      })
    );
    res.json({ identificador, resultados });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Falha no diagnóstico." });
  }
});

// Diagnóstico temporário — dump do item + promoções configuradas nele, pra
// entender de onde vem o desconto Pix mostrado na página pública (preço
// promocional base + % de Pix específico, cada um configurado separado).
// Remover depois.
clonarAnuncioRouter.get("/promo-diag", async (req, res) => {
  const lojaId = Number(req.query.lojaId);
  const itemId = typeof req.query.itemId === "string" ? req.query.itemId : "";
  if (!Number.isInteger(lojaId) || !itemId) {
    res.status(400).json({ error: "Informe ?lojaId=&itemId=" });
    return;
  }
  try {
    const [item, promocoes] = await Promise.all([
      getItemFullComToken(lojaId, itemId),
      consultarPromocoesDoItem(lojaId, itemId),
    ]);

    // Campanha de desconto Pix (type=BANK, sub_type=COFINANCED) é cofinanciada
    // Mercado Livre + vendedor (meli_percentage/seller_percentage), igual ao
    // SMART — mas não aparece na consulta genérica acima, que não pede
    // promotion_type. Doc oficial só mostra consultar POR campanha (exige
    // promotion_id já conhecido) e alterar/remover item passando
    // promotion_type=BANK na própria rota de item — por simetria, tentando
    // aqui o GET desse mesmo endpoint de item com promotion_type=BANK, sem
    // confirmação prévia (não documentado assim explicitamente).
    let promocaoPix: unknown = null;
    try {
      const accessToken = await getValidAccessToken(lojaId);
      const { data } = await axios.get(`https://api.mercadolibre.com/seller-promotions/items/${itemId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { promotion_type: "BANK", app_version: "v2" },
      });
      promocaoPix = data;
    } catch (err: any) {
      promocaoPix = { erro: err?.response?.data ?? err?.message ?? "falhou" };
    }

    res.json({
      preco: item.price,
      officialStoreId: item.official_store_id ?? null,
      titulo: item.title,
      promocoes,
      promocaoPix,
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.response?.data?.message ?? err?.message ?? "Falha ao buscar o diagnóstico." });
  }
});

// Baixa o vídeo do YouTube anexado a um anúncio (campo video_id) — só
// funciona pra anúncio de uma loja que o usuário tem acesso pra clonagem,
// mesma regra do resto do módulo. O YouTube não tem endpoint oficial de
// download; @distube/ytdl-core replica o jeito que o player carrega o vídeo
// (mesma técnica usada por qualquer downloader — pode quebrar se o YouTube
// mudar algo do lado deles, sem aviso prévio).
clonarAnuncioRouter.get("/video", async (req, res) => {
  const url = typeof req.query.url === "string" ? req.query.url : "";
  if (!url.trim()) {
    res.status(400).json({ error: "Informe ?url=<link do anúncio>." });
    return;
  }
  const usuario = req.usuario!;

  try {
    const video = await resolverVideoDoAnuncio(url.trim(), lojasEfetivasParaClonagem(usuario));
    const youtubeUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
    const info = await ytdl.getInfo(youtubeUrl);
    const formato = ytdl.chooseFormat(info.formats, { quality: "highest", filter: "audioandvideo" });
    if (!formato) {
      res.status(500).json({ error: "Não achou um formato de vídeo+áudio combinado pra baixar." });
      return;
    }

    const nomeArquivo = `${video.mlb}-${video.titulo}`
      .replace(/[^\w\s-]/g, "")
      .trim()
      .slice(0, 80);
    res.setHeader("Content-Type", formato.mimeType?.split(";")[0] ?? "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo || video.mlb}.mp4"`);

    ytdl.downloadFromInfo(info, { format: formato }).pipe(res);
  } catch (err) {
    console.error("Erro ao baixar vídeo do anúncio:", err);
    const mensagem = err instanceof Error ? err.message : "Falha ao baixar o vídeo.";
    if (!res.headersSent) res.status(400).json({ error: mensagem });
  }
});

// Domínios de CDN estática do Mercado Livre — únicos aceitos aqui. Sem essa
// checagem, a rota vira um proxy pra baixar QUALQUER url que alguém mandar
// (SSRF), já que ela só repassa o que o ffmpeg buscar.
const DOMINIOS_HLS_PERMITIDOS = [".mlstatic.com"];

function dominioPermitido(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    return protocol === "https:" && DOMINIOS_HLS_PERMITIDOS.some((d) => hostname.endsWith(d));
  } catch {
    return false;
  }
}

// Baixa o vídeo "Clips" do Mercado Livre (substituiu o YouTube em set/2024,
// ver comentário em resolverVideoDoAnuncio) a partir da URL do manifesto
// .m3u8 — não existe API acessível pra descobrir essa URL sozinha pra loja
// local (só existe uma API de Clips documentada, e é exclusiva do programa
// Global Selling — devolveu 403 pro nosso app comum). O usuário pega a URL
// no DevTools do navegador (aba Rede, filtro Media) e cola aqui; o ffmpeg
// remuxa (sem recodificar, -c copy) pra um mp4 de verdade.
clonarAnuncioRouter.get("/video-hls", (req, res) => {
  const url = typeof req.query.url === "string" ? req.query.url : "";
  if (!dominioPermitido(url)) {
    res.status(400).json({ error: "Informe uma URL .m3u8 válida do domínio mlstatic.com." });
    return;
  }

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", 'attachment; filename="video.mp4"');

  const ffmpeg = spawn("ffmpeg", [
    "-i", url,
    "-c", "copy",
    "-bsf:a", "aac_adtstoasc",
    "-movflags", "frag_keyframe+empty_moov",
    "-f", "mp4",
    "pipe:1",
  ]);

  let stderr = "";
  ffmpeg.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  ffmpeg.stdout.pipe(res);
  ffmpeg.on("error", (err) => {
    console.error("Erro ao rodar ffmpeg:", err);
    if (!res.headersSent) res.status(500).json({ error: "ffmpeg não encontrado no servidor." });
  });
  ffmpeg.on("close", (code) => {
    if (code !== 0) {
      console.error(`ffmpeg saiu com código ${code}:`, stderr.slice(-2000));
      if (!res.headersSent) {
        res.status(400).json({ error: "Falha ao processar o vídeo — confira se a URL ainda é válida (elas expiram)." });
      } else {
        res.end();
      }
    }
  });
});

clonarAnuncioRouter.post("/preview", async (req, res) => {
  const { url, lojaDestinoId } = req.body;
  const usuario = req.usuario!;

  if (typeof url !== "string" || !url.trim() || !Number.isInteger(lojaDestinoId)) {
    res.status(400).json({ error: "Informe a URL do anúncio e a loja de destino." });
    return;
  }
  if (!temAcessoLojaParaClonagem(usuario, lojaDestinoId)) {
    res.status(403).json({ error: "Você não tem acesso a essa loja de destino." });
    return;
  }

  try {
    const preview = await montarPreview(url.trim(), lojasEfetivasParaClonagem(usuario));
    res.json(preview);
  } catch (err) {
    console.error("Erro ao montar preview do clone:", err);
    const mensagem = err instanceof Error ? err.message : "Falha ao ler o anúncio original.";
    res.status(500).json({ error: mensagem });
  }
});

clonarAnuncioRouter.post("/publicar", async (req, res) => {
  const {
    url,
    lojaDestinoId,
    titulos,
    listingType,
    ativarFlex,
    imagensPersonalizadas,
    imagensPorVariacao,
    vincularCatalogo,
  } = req.body;
  const usuario = req.usuario!;

  if (
    typeof url !== "string" ||
    !url.trim() ||
    !Number.isInteger(lojaDestinoId) ||
    !Array.isArray(titulos) ||
    titulos.length === 0 ||
    titulos.some((t) => typeof t !== "string" || !t.trim()) ||
    typeof listingType !== "string"
  ) {
    res.status(400).json({ error: "Parâmetros inválidos para publicar o clone." });
    return;
  }
  if (!temAcessoLojaParaClonagem(usuario, lojaDestinoId)) {
    res.status(403).json({ error: "Você não tem acesso a essa loja de destino." });
    return;
  }

  try {
    const resultados = await publicarClone(
      url.trim(),
      lojaDestinoId,
      {
        titulos: titulos.map((t: string) => t.trim()),
        listingType,
        ativarFlex: Boolean(ativarFlex),
        imagensPersonalizadas: Array.isArray(imagensPersonalizadas) ? imagensPersonalizadas : undefined,
        imagensPorVariacao:
          imagensPorVariacao && typeof imagensPorVariacao === "object" ? imagensPorVariacao : undefined,
        vincularCatalogo: Boolean(vincularCatalogo),
      },
      lojasEfetivasParaClonagem(usuario)
    );
    res.json({ resultados });
  } catch (err) {
    console.error("Erro ao publicar clone:", err);
    const mensagem = err instanceof Error ? err.message : "Falha ao publicar o anúncio clonado.";
    res.status(500).json({ error: mensagem });
  }
});
