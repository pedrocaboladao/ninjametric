import { Router, Request, Response } from "express";
import multer from "multer";
import { pool } from "../db/pool";
import {
  criarEntrada,
  excluirEntrada,
  listarEntradas,
  type ItemEntrada,
} from "../services/fabricaEntradasService";
import { planilhaParaTexto } from "../services/fabricaPlanilhaArquivoService";

export const fabricaEntradasRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

function erro(res: Response, err: unknown, padrao: string) {
  console.error("[fabrica-entradas]", err);
  res.status(400).json({ error: err instanceof Error ? err.message : padrao });
}

function numero(v: unknown): number {
  if (typeof v === "number") return v;
  const t = String(v ?? "")
    .replace(/[R$\s]/g, "")
    .trim();
  if (!t) return 0;
  if (/,\d{1,3}$/.test(t)) return Number(t.replace(/\./g, "").replace(",", ".")) || 0;
  return Number(t.replace(/,/g, "")) || 0;
}

function chave(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

fabricaEntradasRouter.get("/", async (_req, res) => {
  try {
    res.json({ entradas: await listarEntradas() });
  } catch (err) {
    erro(res, err, "Falha ao carregar as entradas.");
  }
});

fabricaEntradasRouter.post("/", async (req, res) => {
  const b = req.body ?? {};
  const itens: ItemEntrada[] = Array.isArray(b.itens)
    ? b.itens
        .map((i: Record<string, unknown>) => ({
          produtoId: Number(i.produtoId),
          quantidade: Number(i.quantidade),
          custoUnitario: Number(i.custoUnitario ?? 0),
        }))
        .filter((i: ItemEntrada) => Number.isInteger(i.produtoId) && i.quantidade > 0)
    : [];
  if (!itens.length) return res.status(400).json({ error: "Informe ao menos um item." });
  try {
    res.status(201).json(
      await criarEntrada({
        fornecedorId: Number.isInteger(Number(b.fornecedorId)) && Number(b.fornecedorId) > 0
          ? Number(b.fornecedorId)
          : null,
        fornecedorNome:
          typeof b.fornecedorNome === "string" && b.fornecedorNome.trim()
            ? b.fornecedorNome.trim()
            : null,
        documento:
          typeof b.documento === "string" && b.documento.trim() ? b.documento.trim() : null,
        data: typeof b.data === "string" && b.data ? b.data : null,
        observacao:
          typeof b.observacao === "string" && b.observacao.trim() ? b.observacao.trim() : null,
        itens,
      })
    );
  } catch (err) {
    erro(res, err, "Falha ao lançar a entrada.");
  }
});

fabricaEntradasRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id invalido." });
  try {
    await excluirEntrada(id);
    res.json({ ok: true });
  } catch (err) {
    erro(res, err, "Falha ao excluir a entrada.");
  }
});

// Confere a nota do fornecedor antes de virar entrada.
//
// Nota de compra chega com dezenas de linhas; digitar uma a uma é onde o
// estoque começa a errar. Lê o arquivo, casa o SKU e devolve o que entra e o
// que ficou pendente — nada é gravado aqui.
fabricaEntradasRouter.post(
  "/conferir",
  upload.single("arquivo"),
  async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: "Envie o arquivo." });
    try {
      const texto = await planilhaParaTexto(req.file.buffer, req.file.originalname);
      const linhas = texto.split(/\r?\n/);
      if (!linhas.length) return res.status(400).json({ error: "Arquivo vazio." });

      const separar = (l: string) =>
        (l.includes("\t") ? l.split("\t") : l.split(";")).map((c) => c.trim());

      const COLUNAS: Record<string, string[]> = {
        sku: ["sku", "codigo", "referencia", "produto", "codigoproduto"],
        quantidade: ["quantidade", "qtd", "qtde", "quant"],
        custo: ["custo", "custounitario", "precounitario", "valorunitario", "preco", "unitario"],
        total: ["total", "valortotal", "valor", "precototal"],
      };
      const cab = separar(linhas[0]);
      const pos: Record<string, number> = {};
      cab.forEach((c, i) => {
        const k = chave(c);
        for (const [campo, nomes] of Object.entries(COLUNAS)) {
          if (pos[campo] === undefined && nomes.includes(k)) pos[campo] = i;
        }
      });
      if (pos.sku === undefined) {
        return res.status(400).json({ error: "Não achei a coluna de SKU no arquivo." });
      }

      const { rows } = await pool.query<{ id: number; sku: string; nome: string }>(
        "SELECT id, sku, nome FROM fabrica_produtos"
      );
      const porSku = new Map(rows.map((r) => [chave(r.sku), r]));

      const prontas: Array<Record<string, unknown>> = [];
      const pendentes: Array<Record<string, unknown>> = [];
      let vazias = 0;
      for (let i = 1; i < linhas.length; i++) {
        const cols = separar(linhas[i]);
        if (cols.every((c) => c === "")) {
          vazias++;
          continue;
        }
        const sku = cols[pos.sku] ?? "";
        const qt = pos.quantidade !== undefined ? numero(cols[pos.quantidade]) : 0;
        const total = pos.total !== undefined ? numero(cols[pos.total]) : 0;
        // custo pode vir unitário ou só o total da linha: com a quantidade em
        // mãos, um resolve o outro e a nota entra do jeito que veio
        let custo = pos.custo !== undefined ? numero(cols[pos.custo]) : 0;
        if (!custo && total && qt) custo = total / qt;
        const p = porSku.get(chave(sku));
        const linha = {
          linha: i + 1,
          sku,
          produtoId: p?.id ?? null,
          produtoNome: p?.nome ?? null,
          quantidade: qt,
          custoUnitario: Number(custo.toFixed(4)),
          total: qt * custo,
        };
        if (!sku) pendentes.push({ ...linha, problema: "linha sem SKU" });
        else if (!p) pendentes.push({ ...linha, problema: "SKU não cadastrado" });
        else if (qt <= 0) pendentes.push({ ...linha, problema: "quantidade zerada" });
        else prontas.push(linha);
      }

      res.json({
        colunas: pos,
        linhasNoArquivo: linhas.length - 1,
        linhasVazias: vazias,
        prontas,
        pendentes,
        total: prontas.reduce((s, l) => s + Number(l.total), 0),
        quantidade: prontas.reduce((s, l) => s + Number(l.quantidade), 0),
      });
    } catch (err) {
      erro(res, err, "Falha ao ler o arquivo.");
    }
  }
);
