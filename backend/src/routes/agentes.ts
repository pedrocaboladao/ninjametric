import { Router, Response } from "express";
import { listarPensamentos } from "../services/agenteAdsService";
import { perguntarGrowthHacker, listarBriefings, type MensagemChat } from "../services/growthHackerService";
import { tratarFotoProduto, criarArtePromocional, gerarKitFotos, type DadosKitFotos } from "../services/agenteImagensService";
import {
  listarPerfis,
  criarPerfil,
  excluirPerfil,
  adicionarReferencia,
  listarReferencias,
} from "../services/agenteImagensPerfilService";
import { buscarDadosAnuncio, registrarCorrecoes, type CamposSugeridosKit } from "../services/agenteImagensAnuncioService";
import { verificarOportunidades, listarOportunidades } from "../services/agenteOportunidadesService";
import { listarPensamentosCatalogo } from "../services/agenteCatalogoService";
import { listarPensamentosConversao } from "../services/agenteConversaoService";
import { listarPlanoDiario, marcarItemPlano, verificarPlanoDiarioAgora } from "../services/agentePlanoDiarioService";
import { buscarResumoEscritorio } from "../services/resumoEscritorioService";

export const agentesRouter = Router();

function erro(res: Response, err: unknown, fallback: string) {
  console.error(fallback, err);
  const mensagem = err instanceof Error ? err.message : fallback;
  res.status(400).json({ error: mensagem });
}

agentesRouter.get("/resumo-escritorio", async (req, res) => {
  try {
    res.json(await buscarResumoEscritorio(req.query.forcar === "1"));
  } catch (err) {
    erro(res, err, "Falha ao carregar o resumo do escritório.");
  }
});

agentesRouter.get("/plano-diario", async (_req, res) => {
  try {
    res.json({ pensamentos: await listarPlanoDiario() });
  } catch (err) {
    erro(res, err, "Falha ao carregar o plano do dia.");
  }
});

agentesRouter.post("/plano-diario/verificar", async (_req, res) => {
  try {
    await verificarPlanoDiarioAgora();
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao verificar o plano do dia.");
  }
});

agentesRouter.post("/plano-diario/itens/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { concluido } = req.body ?? {};
  if (!Number.isInteger(id) || typeof concluido !== "boolean") {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await marcarItemPlano(id, concluido);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao marcar item do plano.");
  }
});

agentesRouter.get("/ads/pensamentos", async (_req, res) => {
  try {
    res.json({ pensamentos: await listarPensamentos() });
  } catch (err) {
    erro(res, err, "Falha ao carregar pensamentos.");
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
    const { resposta, pensamento } = await perguntarGrowthHacker(pergunta.trim(), historicoValido);
    res.json({ resposta, pensamento });
  } catch (err) {
    erro(res, err, "Falha ao perguntar pro agente.");
  }
});

agentesRouter.get("/growth-hacker/feed", async (_req, res) => {
  try {
    res.json({ pensamentos: await listarBriefings() });
  } catch (err) {
    erro(res, err, "Falha ao carregar o briefing do Growth Hacker.");
  }
});

agentesRouter.get("/oportunidades", async (_req, res) => {
  try {
    res.json({ oportunidades: await listarOportunidades() });
  } catch (err) {
    erro(res, err, "Falha ao carregar oportunidades.");
  }
});

agentesRouter.post("/oportunidades/verificar", async (_req, res) => {
  try {
    await verificarOportunidades();
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao verificar oportunidades.");
  }
});

agentesRouter.get("/conversao/pensamentos", async (_req, res) => {
  try {
    res.json({ pensamentos: await listarPensamentosConversao() });
  } catch (err) {
    erro(res, err, "Falha ao carregar pensamentos de conversão.");
  }
});

agentesRouter.get("/catalogo/pensamentos", async (_req, res) => {
  try {
    res.json({ pensamentos: await listarPensamentosCatalogo() });
  } catch (err) {
    erro(res, err, "Falha ao carregar pensamentos de catálogo.");
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

function paraLista(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === "string") : [];
}

agentesRouter.post("/imagens/criar-arte", async (req, res) => {
  const { descricao, imagensReferenciaBase64 } = req.body ?? {};
  if (typeof descricao !== "string" || !descricao.trim()) {
    res.status(400).json({ error: "Descrição inválida." });
    return;
  }
  try {
    const resultado = await criarArtePromocional(descricao.trim(), paraLista(imagensReferenciaBase64));
    res.json({ imagemBase64: resultado });
  } catch (err) {
    erro(res, err, "Falha ao gerar a arte.");
  }
});

agentesRouter.post("/imagens/kit", async (req, res) => {
  const {
    imagemBase64,
    imagensReferenciaBase64,
    nomeProduto,
    subtitulo,
    cores,
    beneficios,
    especificacaoPrincipal,
    specsSecundarias,
    ondeAplicar,
    sugestaoOriginal,
  } = req.body ?? {};
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
  const referencias = paraLista(imagensReferenciaBase64);

  if (sugestaoOriginal && typeof sugestaoOriginal === "object") {
    const s = sugestaoOriginal as Partial<CamposSugeridosKit>;
    const sugestao: CamposSugeridosKit = {
      subtitulo: typeof s.subtitulo === "string" ? s.subtitulo : "",
      beneficios: paraLista(s.beneficios),
      especificacaoPrincipal: typeof s.especificacaoPrincipal === "string" ? s.especificacaoPrincipal : "",
      specsSecundarias: paraLista(s.specsSecundarias),
      ondeAplicar: paraLista(s.ondeAplicar),
    };
    registrarCorrecoes(sugestao, {
      subtitulo: dados.subtitulo,
      beneficios: dados.beneficios,
      especificacaoPrincipal: dados.especificacaoPrincipal,
      specsSecundarias: dados.specsSecundarias,
      ondeAplicar: dados.ondeAplicar,
    }).catch((err) => console.error("Falha ao registrar correções do kit (não bloqueia a geração):", err));
  }

  try {
    const imagens = await gerarKitFotos(imagemBase64, dados, referencias);
    res.json({ imagens });
  } catch (err) {
    erro(res, err, "Falha ao gerar o kit de fotos.");
  }
});

agentesRouter.post("/imagens/buscar-anuncio", async (req, res) => {
  const { url } = req.body ?? {};
  if (typeof url !== "string" || !url.trim()) {
    res.status(400).json({ error: "Link do anúncio é obrigatório." });
    return;
  }
  try {
    const dados = await buscarDadosAnuncio(url.trim());
    res.json(dados);
  } catch (err) {
    erro(res, err, "Falha ao buscar dados do anúncio.");
  }
});

agentesRouter.get("/imagens/perfis", async (_req, res) => {
  try {
    res.json({ perfis: await listarPerfis() });
  } catch (err) {
    erro(res, err, "Falha ao carregar perfis.");
  }
});

agentesRouter.post("/imagens/perfis", async (req, res) => {
  const { nome, cores, imagemReferenciaBase64, beneficiosPadrao, ondeAplicarPadrao } = req.body ?? {};
  if (typeof nome !== "string" || !nome.trim()) {
    res.status(400).json({ error: "Nome do perfil é obrigatório." });
    return;
  }
  try {
    const perfil = await criarPerfil({
      nome: nome.trim(),
      cores: typeof cores === "string" ? cores : "",
      imagemReferenciaBase64: typeof imagemReferenciaBase64 === "string" && imagemReferenciaBase64 ? imagemReferenciaBase64 : null,
      beneficiosPadrao: typeof beneficiosPadrao === "string" ? beneficiosPadrao : "",
      ondeAplicarPadrao: typeof ondeAplicarPadrao === "string" ? ondeAplicarPadrao : "",
    });
    res.json({ perfil });
  } catch (err) {
    erro(res, err, "Falha ao salvar perfil.");
  }
});

agentesRouter.delete("/imagens/perfis/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await excluirPerfil(id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao excluir perfil.");
  }
});

agentesRouter.get("/imagens/perfis/:id/referencias", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    res.json({ referencias: await listarReferencias(id) });
  } catch (err) {
    erro(res, err, "Falha ao carregar referências do perfil.");
  }
});

agentesRouter.post("/imagens/perfis/:id/referencias", async (req, res) => {
  const id = Number(req.params.id);
  const { imagemBase64 } = req.body ?? {};
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  if (typeof imagemBase64 !== "string" || !imagemBase64) {
    res.status(400).json({ error: "Imagem inválida." });
    return;
  }
  try {
    await adicionarReferencia(id, imagemBase64);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao favoritar imagem como referência.");
  }
});

