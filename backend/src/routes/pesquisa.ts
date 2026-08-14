import { Router, Request, Response } from "express";
import multer from "multer";
import {
  listarCategorias,
  criarCategoria,
  excluirCategoria,
  listarMeses,
  listarRanking,
  salvarLancamentosDoMes,
  excluirLancamento,
  obterEvolucao,
  importarPlanilha,
  type LancamentoEntrada,
} from "../services/pesquisaService";

export const pesquisaRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function erro(res: Response, err: unknown, fallback: string) {
  console.error(fallback, err);
  const mensagem = err instanceof Error ? err.message : fallback;
  res.status(400).json({ error: mensagem });
}

function validarLinhas(valor: unknown): LancamentoEntrada[] | null {
  if (!Array.isArray(valor)) return null;
  const linhas: LancamentoEntrada[] = [];
  for (const l of valor) {
    const vendedor = typeof l?.vendedor === "string" ? l.vendedor.trim() : "";
    const qtde = Number(l?.qtde);
    const totalReais = Number(l?.totalReais);
    if (!vendedor) return null;
    if (!Number.isFinite(qtde) || qtde < 0) return null;
    if (!Number.isFinite(totalReais) || totalReais < 0) return null;
    linhas.push({ vendedor, qtde, totalReais });
  }
  return linhas;
}

pesquisaRouter.get("/categorias", async (_req: Request, res: Response) => {
  try {
    const categorias = await listarCategorias();
    res.json({ categorias });
  } catch (err) {
    erro(res, err, "Erro ao listar categorias");
  }
});

pesquisaRouter.post("/categorias", async (req: Request, res: Response) => {
  try {
    const nome = typeof req.body?.nome === "string" ? req.body.nome.trim() : "";
    if (!nome) return res.status(400).json({ error: "Nome é obrigatório" });
    const categoria = await criarCategoria(nome);
    res.json(categoria);
  } catch (err) {
    erro(res, err, "Erro ao criar categoria");
  }
});

pesquisaRouter.delete("/categorias/:id", async (req: Request, res: Response) => {
  try {
    await excluirCategoria(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Erro ao excluir categoria");
  }
});

pesquisaRouter.get("/categorias/:id/meses", async (req: Request, res: Response) => {
  try {
    const meses = await listarMeses(Number(req.params.id));
    res.json({ meses });
  } catch (err) {
    erro(res, err, "Erro ao listar meses");
  }
});

pesquisaRouter.get("/categorias/:id/ranking", async (req: Request, res: Response) => {
  try {
    const mes = typeof req.query.mes === "string" ? req.query.mes : "";
    if (!mes) return res.status(400).json({ error: "Parâmetro mes é obrigatório" });
    const ranking = await listarRanking(Number(req.params.id), mes);
    res.json({ ranking });
  } catch (err) {
    erro(res, err, "Erro ao listar ranking");
  }
});

pesquisaRouter.post("/categorias/:id/lancamentos", async (req: Request, res: Response) => {
  try {
    const mes = typeof req.body?.mes === "string" ? req.body.mes : "";
    if (!mes) return res.status(400).json({ error: "Mês é obrigatório" });
    const linhas = validarLinhas(req.body?.linhas);
    if (!linhas) return res.status(400).json({ error: "Linhas inválidas" });
    await salvarLancamentosDoMes(Number(req.params.id), mes, linhas);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Erro ao salvar lançamentos");
  }
});

pesquisaRouter.delete("/lancamentos/:id", async (req: Request, res: Response) => {
  try {
    await excluirLancamento(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Erro ao excluir lançamento");
  }
});

pesquisaRouter.get("/categorias/:id/evolucao", async (req: Request, res: Response) => {
  try {
    const evolucao = await obterEvolucao(Number(req.params.id));
    res.json(evolucao);
  } catch (err) {
    erro(res, err, "Erro ao obter evolução");
  }
});

pesquisaRouter.post("/importar-planilha", upload.single("arquivo"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado" });
    const resumo = await importarPlanilha(req.file.buffer);
    res.json({ resumo });
  } catch (err) {
    erro(res, err, "Erro ao importar planilha");
  }
});
