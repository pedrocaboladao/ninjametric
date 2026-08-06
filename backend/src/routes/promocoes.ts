import { Router, Request, Response } from "express";
import { listarCampanhas, criarCampanha, recriarCampanha } from "../services/promocoesService";
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

promocoesRouter.get("/", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  try {
    res.json({ campanhas: await listarCampanhas(filtro.lojaId, filtro.lojasPermitidas) });
  } catch (err) {
    erro(res, err, "Falha ao carregar campanhas.");
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
    res.json(await criarCampanha(lojaIdNum, nome.trim(), percentualNum, itemIds));
  } catch (err) {
    erro(res, err, "Falha ao criar campanha.");
  }
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
