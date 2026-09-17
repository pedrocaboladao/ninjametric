import { Router } from "express";
import ytdl from "@distube/ytdl-core";
import { montarPreview, publicarClone, resolverVideoDoAnuncio } from "../services/clonarAnuncioService";
import { temAcessoLojaParaClonagem, lojasEfetivasParaClonagem } from "../services/usuariosService";
import { listLojas } from "../services/tokenStore";
import { extrairItemIdDaUrl, getItemFullComToken, resolverItemIdPorUserProduct } from "../services/mercadoLivreItems";

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
