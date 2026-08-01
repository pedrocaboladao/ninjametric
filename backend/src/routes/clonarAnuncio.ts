import { Router } from "express";
import axios from "axios";
import { montarPreview, publicarClone } from "../services/clonarAnuncioService";
import { temAcessoLojaParaClonagem, lojasEfetivasParaClonagem } from "../services/usuariosService";
import { listLojas, getValidAccessToken } from "../services/tokenStore";

export const clonarAnuncioRouter = Router();

// TEMP: investigar o 403 do endpoint de ativação de envios flex.
clonarAnuncioRouter.get("/debug-flex", async (req, res) => {
  const itemId = String(req.query.itemId);
  const lojaId = Number(req.query.lojaId);
  const token = await getValidAccessToken(lojaId);

  const respostas: Record<string, unknown> = {};

  // 1) Como está o shipping do item já criado?
  try {
    const { data } = await axios.get(`https://api.mercadolibre.com/items/${itemId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    respostas.shipping = data.shipping;
    respostas.site_id = data.site_id;
  } catch (err: any) {
    respostas.erroBuscarItem = err.message;
  }

  // 2) Tenta ativar flex e captura o erro completo (headers inclusive).
  try {
    const { data } = await axios.post(
      `https://api.mercadolibre.com/sites/MLB/shipping/selfservice/items/${itemId}`,
      {},
      { headers: { Authorization: `Bearer ${token}` } }
    );
    respostas.flexAtivado = data;
  } catch (err: any) {
    respostas.erroFlex = {
      message: err.message,
      status: err.response?.status,
      headers: err.response?.headers,
      data: typeof err.response?.data === "string" ? err.response.data.slice(0, 300) : err.response?.data,
    };
  }

  res.json(respostas);
});

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
  const { url, lojaDestinoId, titulos, listingType, ativarFlex, imagensPersonalizadas, imagensPorVariacao } =
    req.body;
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
