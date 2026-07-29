import { Router } from "express";
import { montarPreview, publicarClone } from "../services/clonarAnuncioService";

export const clonarAnuncioRouter = Router();

clonarAnuncioRouter.post("/preview", async (req, res) => {
  const { url, lojaDestinoId } = req.body;

  if (typeof url !== "string" || !url.trim() || !Number.isInteger(lojaDestinoId)) {
    res.status(400).json({ error: "Informe a URL do anúncio e a loja de destino." });
    return;
  }

  try {
    const preview = await montarPreview(url.trim());
    res.json(preview);
  } catch (err) {
    console.error("Erro ao montar preview do clone:", err);
    const mensagem = err instanceof Error ? err.message : "Falha ao ler o anúncio original.";
    res.status(500).json({ error: mensagem });
  }
});

clonarAnuncioRouter.post("/publicar", async (req, res) => {
  const { url, lojaDestinoId, titulos, listingType, ativarFlex, imagensPersonalizadas, imagensPorVariacao } =
    req.body;

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

  try {
    const resultados = await publicarClone(url.trim(), lojaDestinoId, {
      titulos: titulos.map((t: string) => t.trim()),
      listingType,
      ativarFlex: Boolean(ativarFlex),
      imagensPersonalizadas: Array.isArray(imagensPersonalizadas) ? imagensPersonalizadas : undefined,
      imagensPorVariacao:
        imagensPorVariacao && typeof imagensPorVariacao === "object" ? imagensPorVariacao : undefined,
    });
    res.json({ resultados });
  } catch (err) {
    console.error("Erro ao publicar clone:", err);
    const mensagem = err instanceof Error ? err.message : "Falha ao publicar o anúncio clonado.";
    res.status(500).json({ error: mensagem });
  }
});
