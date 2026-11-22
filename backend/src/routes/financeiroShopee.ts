import { Router, Request, Response } from "express";
import { chamarApiAssinada } from "../services/shopeeAuth";
import { listarTaxasAfiliado, recalcularTaxaAfiliado } from "../services/shopeeAfiliadoEstimativaService";
import { listarVendasFinanceirasShopee, diagnosticarAfiliadoShopee } from "../services/financeiroShopeeService";
import { temAcessoLoja, lojasEfetivas } from "../services/usuariosService";
import { listLojas } from "../services/tokenStore";

export const financeiroShopeeRouter = Router();

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function extrairDatas(req: Request): { dataInicio?: string; dataFim?: string } {
  const { dataInicio, dataFim } = req.query;
  if (typeof dataInicio === "string" && typeof dataFim === "string" && DATA_REGEX.test(dataInicio) && DATA_REGEX.test(dataFim)) {
    return { dataInicio, dataFim };
  }
  return {};
}

// Resolve o filtro de loja (id específico, "todas" ou "minhas") pro usuário
// logado — mesmo padrão de routes/financeiro.ts.
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

financeiroShopeeRouter.get("/", async (req, res) => {
  const filtro = resolverLojaFiltro(req, res);
  if (!filtro) return;
  const { dataInicio, dataFim } = extrairDatas(req);
  const forcar = req.query.forcar === "1";

  try {
    const resultado = await listarVendasFinanceirasShopee(
      filtro.lojaId,
      filtro.lojasPermitidas,
      dataInicio,
      dataFim,
      forcar
    );
    res.json(resultado);
  } catch (err) {
    console.error("Erro ao montar feed financeiro Shopee:", err);
    res.status(500).json({ error: "Falha ao carregar vendas da Shopee." });
  }
});

// Diagnóstico da comissão de afiliado (AMS) — só admin. Abra no navegador
// logado: /api/financeiro-shopee/diagnostico-afiliado?loja=pinta&termo=pedra
// (dias, limite, status=COMPLETED e pedido=NUMERO,NUMERO, de=AAAA-MM-DD e ate=AAAA-MM-DD opcionais; padrão 2 dias, 8 pedidos).
financeiroShopeeRouter.get("/diagnostico-afiliado", async (req, res) => {
  if (!req.usuario?.admin) {
    res.status(403).json({ error: "Só admin." });
    return;
  }
  // lojaId numérico, ou "loja=pinta" (pedaço do nome) pra não precisar saber o id.
  let lojaId = Number(req.query.lojaId);
  if (!Number.isInteger(lojaId) && typeof req.query.loja === "string") {
    const nome = req.query.loja.toLowerCase();
    const achada = (await listLojas()).find((l) => l.nome.toLowerCase().includes(nome));
    if (achada) lojaId = achada.id;
  }
  if (!Number.isInteger(lojaId)) {
    res.status(400).json({ error: "Informe lojaId ou loja (parte do nome)." });
    return;
  }
  const dias = Math.min(Math.max(Number(req.query.dias) || 2, 1), 30);
  // resumo=1: uma linha curta por pedido (datas, afiliado, se a regra ainda o
  // trata como pendente) e até 120 pedidos — pra medir a regra sem colar um
  // extrato inteiro por pedido.
  const resumo = req.query.resumo === "1";
  const limite = Math.min(Math.max(Number(req.query.limite) || 8, 1), resumo ? 120 : 30);
  const termo = typeof req.query.termo === "string" && req.query.termo.trim() ? req.query.termo.trim() : null;
  const status = typeof req.query.status === "string" && req.query.status.trim() ? req.query.status.trim().toUpperCase() : null;
  const orderSns =
    typeof req.query.pedido === "string"
      ? req.query.pedido.split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z0-9]{8,20}$/.test(x))
      : null;
  const de = typeof req.query.de === "string" && DATA_REGEX.test(req.query.de) ? req.query.de : null;
  const ate = typeof req.query.ate === "string" && DATA_REGEX.test(req.query.ate) ? req.query.ate : de;
  const intervalo = de && ate ? { de, ate } : null;
  try {
    const d = await diagnosticarAfiliadoShopee(lojaId, dias, termo, limite, status, orderSns, intervalo);
    if (!resumo) {
      res.json(d);
      return;
    }
    const comAfiliado = d.pedidos.filter((p) => (p.campos.order_ams_commission_fee ?? 0) > 0);
    const diasDosComAfiliado = comAfiliado.map((p) => p.diasDesdeAtualizacao).filter((x): x is number => x !== null);
    res.json({
      parcial: d.parcial,
      erros: d.erros.length,
      pedidosAnalisados: d.pedidosAnalisados,
      porStatus: d.porStatus,
      comAfiliado: comAfiliado.length,
      pendentesPelaRegra: d.pedidos.filter((p) => p.pendentePelaRegra).length,
      // Afiliado JÁ informado em pedido que a regra ainda chama de pendente:
      // prova de que a regra espera mais do que a Shopee precisa.
      comAfiliadoMasPendentePelaRegra: comAfiliado.filter((p) => p.pendentePelaRegra).length,
      menorDiasDesdeAtualizacaoComAfiliado: diasDosComAfiliado.length > 0 ? Math.min(...diasDosComAfiliado) : null,
      camposDeTempoVistos: Array.from(new Set(d.pedidos.flatMap((p) => Object.keys(p.camposDeTempo)))),
      pedidos: d.pedidos.map((p) => ({
        sn: p.orderSn,
        st: p.status,
        criado: p.criadoEm.slice(0, 10),
        atualizado: p.atualizadoEm?.slice(0, 10) ?? null,
        dias: p.diasDesdeAtualizacao,
        ams: p.campos.order_ams_commission_fee ?? 0,
        pend: p.pendentePelaRegra,
        tempo: p.camposDeTempo,
      })),
    });
  } catch (err) {
    console.error("Erro no diagnóstico de afiliado Shopee:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Falha no diagnóstico." });
  }
});

// Sonda da API de afiliados da Shopee (AMS) — só admin, só leitura (GET).
// Serve pra descobrir se o app tem permissão e quais parâmetros o relatório de
// conversões aceita. Ex.:
// /api/financeiro-shopee/diagnostico-ams?loja=catedral&caminho=get_conversion_report&start_time=1763000000&end_time=1763600000&page_no=1&page_size=20
// Devolve a resposta crua da Shopee (inclusive o erro, que diz o que falta).
financeiroShopeeRouter.get("/diagnostico-ams", async (req, res) => {
  if (!req.usuario?.admin) {
    res.status(403).json({ error: "Só admin." });
    return;
  }
  const caminho = typeof req.query.caminho === "string" ? req.query.caminho : "";
  if (!/^[a-z_]{3,60}$/.test(caminho)) {
    res.status(400).json({ error: "Informe caminho (ex.: get_conversion_report)." });
    return;
  }
  let lojaId = Number(req.query.lojaId);
  if (!Number.isInteger(lojaId) && typeof req.query.loja === "string") {
    const nome = req.query.loja.toLowerCase();
    const achada = (await listLojas()).find((l) => l.nome.toLowerCase().includes(nome));
    if (achada) lojaId = achada.id;
  }
  if (!Number.isInteger(lojaId)) {
    res.status(400).json({ error: "Informe lojaId ou loja (parte do nome)." });
    return;
  }
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (k === "caminho" || k === "loja" || k === "lojaId") continue;
    if (typeof v === "string") params[k] = v;
  }
  try {
    res.json(await chamarApiAssinada<unknown>(lojaId, `/api/v2/ams/${caminho}`, params));
  } catch (err) {
    const corpo = (err as { response?: { status?: number; data?: unknown } })?.response;
    res.status(200).json({
      falhou: true,
      status: corpo?.status ?? null,
      resposta: corpo?.data ?? (err instanceof Error ? err.message : "erro"),
    });
  }
});

// Estado da estimativa de afiliado (só admin). Mostra a taxa média que o sistema
// está usando por loja/anúncio. Com ?recalcular=pinta recalcula essa loja agora
// (pode levar ~1 minuto).
financeiroShopeeRouter.get("/taxas-afiliado", async (req, res) => {
  if (!req.usuario?.admin) {
    res.status(403).json({ error: "Só admin." });
    return;
  }
  try {
    if (typeof req.query.recalcular === "string" && req.query.recalcular.trim()) {
      const nome = req.query.recalcular.toLowerCase();
      const achada = (await listLojas()).find((l) => l.nome.toLowerCase().includes(nome));
      if (!achada) {
        res.status(400).json({ error: "Loja não encontrada." });
        return;
      }
      await recalcularTaxaAfiliado(achada.id);
    }
    const lojas = await listLojas();
    res.json(
      listarTaxasAfiliado().map((t) => ({ ...t, lojaNome: lojas.find((l) => l.id === t.lojaId)?.nome ?? null }))
    );
  } catch (err) {
    console.error("Erro ao consultar as taxas de afiliado:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Falha." });
  }
});
