import { Router, Request, Response } from "express";
import {
  listarCampanhas,
  criarCampanha,
  recriarCampanha,
  registrarCampanhaExistente,
  iniciarDescobertaCampanhas,
  obterProgressoDescoberta,
  excluirCampanha,
  limparCampanhas,
  type ResultadoCriarCampanha,
} from "../services/promocoesService";
import {
  iniciarBuscaOportunidades,
  obterProgressoBuscaOportunidades,
  listarOportunidades,
  aprovarOportunidade,
  rejeitarOportunidade,
  limparOportunidades,
} from "../services/promocoesOportunidadesService";
import { temAcessoLoja, lojasEfetivas } from "../services/usuariosService";

export const promocoesRouter = Router();

function erro(res: Response, err: unknown, fallback: string) {
  console.error(fallback, err);
  const mensagem = err instanceof Error ? err.message : fallback;
  res.status(400).json({ error: mensagem });
}

// Mesmo padrão duplicado por arquivo do resto do sistema.
function resolverLojaFiltro(req: Request, res: Response): { lojaId?: number; lojasPermitidas?: number[] } | null {
  const lojaIdParam = req.query.lojaId;
  const usuario = req.usuario!;

  if (lojaIdParam === "minhas") {
    return { lojaId: undefined, lojasPermitidas: usuario.lojas };
  }

  const lojaId =
    typeof lojaIdParam === "string" && Number.isInteger(Number(lojaIdParam)) ? Number(lojaIdParam) : undefined;

  if (lojaId !== undefined && !temAcessoLoja(usuario, lojaId)) {
    res.status(403).json({ error: "Você não tem acesso a essa loja." });
    return null;
  }

  return { lojaId, lojasPermitidas: lojasEfetivas(usuario) };
}

// Descoberta automática: varre anúncio por anúncio de cada loja procurando
// campanha já ativa (ver promocoesService.iniciarDescobertaCampanhas) — é
// lenta de propósito (concorrência baixa), por isso roda em segundo plano;
// a rota só dispara e devolve na hora, o front consulta o progresso à parte.
promocoesRouter.post("/descobrir", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  try {
    await iniciarDescobertaCampanhas(filtro.lojaId, filtro.lojasPermitidas);
    res.json({ iniciado: true });
  } catch (err) {
    erro(res, err, "Falha ao iniciar descoberta.");
  }
});

promocoesRouter.get("/descobrir/status", async (_req, res) => {
  res.json(obterProgressoDescoberta());
});

promocoesRouter.get("/", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  try {
    res.json({ campanhas: await listarCampanhas(filtro.lojaId, filtro.lojasPermitidas) });
  } catch (err) {
    erro(res, err, "Falha ao carregar campanhas.");
  }
});

// Só apaga o rastreamento no painel — não mexe em nada real no Mercado
// Livre. Usado pra limpar registros de teste/bugs já corrigidos.
promocoesRouter.delete("/", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  try {
    const apagadas = await limparCampanhas(filtro.lojaId, filtro.lojasPermitidas);
    res.json({ apagadas });
  } catch (err) {
    erro(res, err, "Falha ao limpar campanhas.");
  }
});

// Precisa vir ANTES de "/:id" abaixo — senão Express casa "/oportunidades"
// com aquela rota primeiro (id="oportunidades", 400 antes de chegar aqui).
promocoesRouter.delete("/oportunidades", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  try {
    const apagadas = await limparOportunidades(filtro.lojaId, filtro.lojasPermitidas);
    res.json({ apagadas });
  } catch (err) {
    erro(res, err, "Falha ao limpar oportunidades.");
  }
});

promocoesRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  try {
    await excluirCampanha(id, filtro.lojaId, filtro.lojasPermitidas);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao excluir campanha.");
  }
});

promocoesRouter.post("/", async (req, res) => {
  const { lojaId, nome, percentual, itemIds } = req.body ?? {};
  const lojaIdNum = Number(lojaId);
  const percentualNum = Number(percentual);
  if (!Number.isInteger(lojaIdNum)) {
    res.status(400).json({ error: "Informe a loja." });
    return;
  }
  if (!temAcessoLoja(req.usuario!, lojaIdNum)) {
    res.status(403).json({ error: "Você não tem acesso a essa loja." });
    return;
  }
  if (typeof nome !== "string" || !nome.trim()) {
    res.status(400).json({ error: "Informe o nome da campanha." });
    return;
  }
  if (!Number.isFinite(percentualNum)) {
    res.status(400).json({ error: "Percentual inválido." });
    return;
  }
  if (!Array.isArray(itemIds) || itemIds.some((id) => typeof id !== "string")) {
    res.status(400).json({ error: "Lista de itens inválida." });
    return;
  }
  try {
    const itens = itemIds.map((itemId: string) => ({ itemId, percentual: percentualNum }));
    res.json(await criarCampanha(lojaIdNum, nome.trim(), itens));
  } catch (err) {
    erro(res, err, "Falha ao criar campanha.");
  }
});

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Registra em lote campanhas que já existem no Mercado Livre — não cria
// nada novo, não escreve nada no ML, só ensina o painel sobre elas (ver
// registrarCampanhaExistente). Best-effort: uma linha com erro não trava
// as outras, o resultado devolve sucesso/erro por linha.
promocoesRouter.post("/registrar", async (req, res) => {
  const { registros } = req.body ?? {};
  if (!Array.isArray(registros) || registros.length === 0) {
    res.status(400).json({ error: "Nenhum registro enviado." });
    return;
  }

  const resultados: { linha: number; ok: boolean; erro?: string; resultado?: ResultadoCriarCampanha }[] = [];

  for (let i = 0; i < registros.length; i++) {
    const r = registros[i] ?? {};
    const lojaIdNum = Number(r.lojaId);
    const percentualNum = Number(r.percentual);

    if (!Number.isInteger(lojaIdNum) || !temAcessoLoja(req.usuario!, lojaIdNum)) {
      resultados.push({ linha: i + 1, ok: false, erro: "Loja inválida ou sem acesso." });
      continue;
    }
    if (typeof r.nome !== "string" || !r.nome.trim()) {
      resultados.push({ linha: i + 1, ok: false, erro: "Nome da campanha faltando." });
      continue;
    }
    if (!Number.isFinite(percentualNum)) {
      resultados.push({ linha: i + 1, ok: false, erro: "Percentual inválido." });
      continue;
    }
    if (typeof r.dataFim !== "string" || !DATA_REGEX.test(r.dataFim)) {
      resultados.push({ linha: i + 1, ok: false, erro: "Data de vencimento inválida (use AAAA-MM-DD)." });
      continue;
    }
    if (!Array.isArray(r.itemIds) || r.itemIds.length === 0 || r.itemIds.some((id: unknown) => typeof id !== "string")) {
      resultados.push({ linha: i + 1, ok: false, erro: "Lista de itens inválida." });
      continue;
    }

    try {
      const resultado = await registrarCampanhaExistente({
        lojaId: lojaIdNum,
        nome: r.nome.trim(),
        percentualDesconto: percentualNum,
        itemIds: r.itemIds,
        dataFim: r.dataFim,
        promotionId: typeof r.promotionId === "string" ? r.promotionId : undefined,
      });
      resultados.push({ linha: i + 1, ok: true, resultado });
    } catch (err) {
      resultados.push({ linha: i + 1, ok: false, erro: err instanceof Error ? err.message : "Falha ao registrar." });
    }
  }

  res.json({ resultados });
});

promocoesRouter.post("/:id/recriar", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    res.json(await recriarCampanha(id));
  } catch (err) {
    erro(res, err, "Falha ao recriar campanha.");
  }
});

// Oportunidades: promoções que o próprio Mercado Livre sugere (SMART/DEAL/
// PRICE_DISCOUNT candidatas) com margem calculada no cenário conservador —
// ver promocoesOportunidadesService. Nunca entra sozinho: "aprovar" é a
// única rota que chama o Mercado Livre de verdade.
promocoesRouter.post("/oportunidades/buscar", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  try {
    await iniciarBuscaOportunidades(filtro.lojaId, filtro.lojasPermitidas);
    res.json({ iniciado: true });
  } catch (err) {
    erro(res, err, "Falha ao iniciar busca de oportunidades.");
  }
});

promocoesRouter.get("/oportunidades/buscar/status", async (_req, res) => {
  res.json(obterProgressoBuscaOportunidades());
});

// Precisa vir ANTES de "/:id" (linha ~93) — senão Express casa
// "/oportunidades" com aquela rota primeiro (id="oportunidades", 400 antes
// de chegar aqui).
promocoesRouter.get("/oportunidades", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  try {
    res.json({ oportunidades: await listarOportunidades(filtro.lojaId, filtro.lojasPermitidas) });
  } catch (err) {
    erro(res, err, "Falha ao carregar oportunidades.");
  }
});

promocoesRouter.post("/oportunidades/:id/aprovar", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  try {
    await aprovarOportunidade(id, filtro.lojaId, filtro.lojasPermitidas);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao aprovar oportunidade.");
  }
});

promocoesRouter.post("/oportunidades/:id/rejeitar", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  try {
    await rejeitarOportunidade(id, filtro.lojaId, filtro.lojasPermitidas);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao rejeitar oportunidade.");
  }
});
