import { Router, Response } from "express";
import {
  verificarAgenteAds,
  listarObservacoes,
  confirmarObservacao,
  listarPensamentos,
  perguntarAgenteAds,
  type MensagemChat,
} from "../services/agenteAdsService";
import { tratarFotoProduto, criarArtePromocional, gerarKitFotos, type DadosKitFotos } from "../services/agenteImagensService";

export const agentesRouter = Router();

function erro(res: Response, err: unknown, fallback: string) {
  console.error(fallback, err);
  const mensagem = err instanceof Error ? err.message : fallback;
  res.status(400).json({ error: mensagem });
}

agentesRouter.get("/ads/feed", async (req, res) => {
  const status = req.query.status;
  const statusValido = status === "pendente" || status === "resolvida" ? status : undefined;
  try {
    res.json({ observacoes: await listarObservacoes(statusValido) });
  } catch (err) {
    erro(res, err, "Falha ao carregar observações.");
  }
});

agentesRouter.get("/ads/pensamentos", async (_req, res) => {
  try {
    res.json({ pensamentos: await listarPensamentos() });
  } catch (err) {
    erro(res, err, "Falha ao carregar pensamentos.");
  }
});

agentesRouter.post("/ads/verificar", async (_req, res) => {
  try {
    res.json(await verificarAgenteAds());
  } catch (err) {
    erro(res, err, "Falha ao verificar.");
  }
});

agentesRouter.post("/ads/perguntar", async (req, res) => {
  const { pergunta, historico } = req.body ?? {};
  if (typeof pergunta !== "string" || !pergunta.trim()) {
    res.status(400).json({ error: "Pergunta inválida." });
    return;
  }
  const historicoValido: MensagemChat[] = Array.isArray(historico)
    ? historico.filter(
        (m): m is MensagemChat => !!m && (m.papel === "usuario" || m.papel === "agente") && typeof m.texto === "string"
      )
    : [];
  try {
    const resposta = await perguntarAgenteAds(pergunta.trim(), historicoValido);
    res.json({ resposta });
  } catch (err) {
    erro(res, err, "Falha ao perguntar pro agente.");
  }
});

agentesRouter.post("/imagens/tratar-foto", async (req, res) => {
  const { imagemBase64 } = req.body ?? {};
  if (typeof imagemBase64 !== "string" || !imagemBase64) {
    res.status(400).json({ error: "Imagem inválida." });
    return;
  }
  try {
    const resultado = await tratarFotoProduto(imagemBase64);
    res.json({ imagemBase64: resultado });
  } catch (err) {
    erro(res, err, "Falha ao tratar a foto.");
  }
});

agentesRouter.post("/imagens/criar-arte", async (req, res) => {
  const { descricao } = req.body ?? {};
  if (typeof descricao !== "string" || !descricao.trim()) {
    res.status(400).json({ error: "Descrição inválida." });
    return;
  }
  try {
    const resultado = await criarArtePromocional(descricao.trim());
    res.json({ imagemBase64: resultado });
  } catch (err) {
    erro(res, err, "Falha ao gerar a arte.");
  }
});

function paraLista(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === "string") : [];
}

agentesRouter.post("/imagens/kit", async (req, res) => {
  const { imagemBase64, nomeProduto, subtitulo, cores, beneficios, especificacaoPrincipal, specsSecundarias, ondeAplicar } =
    req.body ?? {};
  if (typeof imagemBase64 !== "string" || !imagemBase64) {
    res.status(400).json({ error: "Imagem inválida." });
    return;
  }
  if (typeof nomeProduto !== "string" || !nomeProduto.trim()) {
    res.status(400).json({ error: "Nome do produto é obrigatório." });
    return;
  }
  const dados: DadosKitFotos = {
    nomeProduto: nomeProduto.trim(),
    subtitulo: typeof subtitulo === "string" ? subtitulo.trim() : "",
    cores: typeof cores === "string" && cores.trim() ? cores.trim() : "cores vivas e legíveis, estilo e-commerce brasileiro",
    beneficios: paraLista(beneficios),
    especificacaoPrincipal: typeof especificacaoPrincipal === "string" ? especificacaoPrincipal.trim() : "",
    specsSecundarias: paraLista(specsSecundarias),
    ondeAplicar: paraLista(ondeAplicar),
  };
  try {
    const imagens = await gerarKitFotos(imagemBase64, dados);
    res.json({ imagens });
  } catch (err) {
    erro(res, err, "Falha ao gerar o kit de fotos.");
  }
});

agentesRouter.post("/ads/:id/confirmar", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await confirmarObservacao(id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao confirmar observação.");
  }
});
