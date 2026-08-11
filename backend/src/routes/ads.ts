import { Router, Request, Response } from "express";
import { listarCampanhasAds } from "../services/adsService";
import { listarReceitaRealPorCampanha } from "../services/tacosService";
import { temAcessoLoja, lojasEfetivas } from "../services/usuariosService";
import { pool } from "../db/pool";

export const adsRouter = Router();

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function extrairDatas(req: Request): { dataInicio?: string; dataFim?: string } {
  const { dataInicio, dataFim } = req.query;
  if (typeof dataInicio === "string" && typeof dataFim === "string" && DATA_REGEX.test(dataInicio) && DATA_REGEX.test(dataFim)) {
    return { dataInicio, dataFim };
  }
  return {};
}

// Resolve o filtro de loja (id específico, "todas" ou "minhas") pro usuário
// logado — devolve null e já responde o erro se a loja pedida não é
// permitida.
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

adsRouter.get("/", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  const { dataInicio, dataFim } = extrairDatas(req);
  const forcar = req.query.forcar === "1";

  try {
    const campanhas = await listarCampanhasAds(filtro.lojaId, filtro.lojasPermitidas, dataInicio, dataFim, forcar);
    res.json({ campanhas });
  } catch (err) {
    console.error("Erro ao listar campanhas de Ads:", err);
    res.status(500).json({ error: "Falha ao carregar campanhas de Ads." });
  }
});

// TEMPORÁRIO — só pra achar a causa da divergência entre Financeiro (usa
// ads_gasto_diario) e Gestão de Ads (usa listarCampanhasAds ao vivo).
// Remover depois de identificar o problema.
adsRouter.get("/debug/snapshot-diario", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  const { dataInicio, dataFim } = extrairDatas(req);
  if (!dataInicio || !dataFim) {
    res.status(400).json({ error: "Informe dataInicio e dataFim (YYYY-MM-DD)." });
    return;
  }

  try {
    const lojaIds = filtro.lojaId !== undefined ? [filtro.lojaId] : filtro.lojasPermitidas;
    const params: unknown[] = [dataInicio, dataFim];
    let condLoja = "";
    if (lojaIds !== undefined) {
      params.push(lojaIds);
      condLoja = "AND loja_id = ANY($3::int[])";
    }

    const { rows } = await pool.query<{
      loja_id: number;
      campanha_id: number;
      data: string;
      nome: string;
      custo: string;
      atualizado_em: string;
    }>(
      `SELECT loja_id, campanha_id, data::text AS data, nome, custo, atualizado_em
       FROM ads_gasto_diario
       WHERE data BETWEEN $1 AND $2 ${condLoja}
       ORDER BY data, campanha_id`,
      params
    );

    const somaPorDia = new Map<string, number>();
    for (const r of rows) {
      somaPorDia.set(r.data, (somaPorDia.get(r.data) ?? 0) + Number(r.custo));
    }

    res.json({
      totalLinhas: rows.length,
      somaPorDia: Object.fromEntries(somaPorDia),
      totalGeral: Array.from(somaPorDia.values()).reduce((a, b) => a + b, 0),
      linhas: rows,
    });
  } catch (err) {
    console.error("Erro no debug de snapshot diario de ads:", err);
    res.status(500).json({ error: "Falha ao consultar snapshot diario." });
  }
});

adsRouter.get("/tacos", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  const { dataInicio, dataFim } = extrairDatas(req);

  try {
    const receitas = await listarReceitaRealPorCampanha(filtro.lojaId, filtro.lojasPermitidas, dataInicio, dataFim);
    res.json({ receitas });
  } catch (err) {
    console.error("Erro ao calcular receita real por campanha:", err);
    res.status(500).json({ error: "Falha ao calcular receita real por campanha." });
  }
});
