import { Router, Request, Response } from "express";
import multer from "multer";
import {
  conferirPix,
  excluirOrigem,
  importarPix,
  lerRelatorioPix,
  listarOrigens,
  salvarOrigem,
  type DestinoPix,
} from "../services/fabricaPixService";

export const fabricaPixRouter = Router();

// o relatório de um mês cheio deu 130 linhas e 20 KB; 10 MB cobre um ano
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const DESTINOS: DestinoPix[] = ["CLIENTE", "APORTE", "AVULSA", "IGNORAR"];

function erro(res: Response, err: unknown, msg: string) {
  console.error(msg, err);
  res.status(500).json({ error: err instanceof Error ? err.message : msg });
}

fabricaPixRouter.get("/origens", async (_req, res) => {
  try {
    res.json({ origens: await listarOrigens() });
  } catch (err) {
    erro(res, err, "Falha ao carregar as origens.");
  }
});

fabricaPixRouter.post("/origens", async (req, res) => {
  const b = req.body ?? {};
  const nome = typeof b.nome === "string" ? b.nome.trim() : "";
  if (!nome) return res.status(400).json({ error: "Informe o nome do pagador." });
  const destino: DestinoPix = DESTINOS.includes(b.destino) ? b.destino : "CLIENTE";
  const clienteId = Number.isInteger(Number(b.clienteId)) ? Number(b.clienteId) : null;
  try {
    await salvarOrigem(nome, clienteId, destino);
    res.status(201).json({ origens: await listarOrigens() });
  } catch (err) {
    erro(res, err, "Falha ao salvar a origem.");
  }
});

fabricaPixRouter.delete("/origens/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id invalido." });
  try {
    await excluirOrigem(id);
    res.json({ origens: await listarOrigens() });
  } catch (err) {
    erro(res, err, "Falha ao excluir a origem.");
  }
});

// Confere sem gravar nada: mostra o que vai entrar, o que já entrou e o que
// ficou sem dono. É sempre este o primeiro passo — lançar 178 pagamentos sem
// olhar antes mexeria no saldo de todas as lojas de uma vez.
fabricaPixRouter.post(
  "/conferir",
  upload.single("arquivo"),
  async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: "Envie o arquivo .xlsx." });
    try {
      const { linhas, total, ignoradas } = await lerRelatorioPix(req.file.buffer);
      res.json(await conferirPix(linhas, total, ignoradas));
    } catch (err) {
      erro(res, err, "Falha ao ler o relatório Pix.");
    }
  }
);

fabricaPixRouter.post(
  "/importar",
  upload.single("arquivo"),
  async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: "Envie o arquivo .xlsx." });
    try {
      const { linhas } = await lerRelatorioPix(req.file.buffer);
      res.json(await importarPix(linhas));
    } catch (err) {
      erro(res, err, "Falha ao importar o relatório Pix.");
    }
  }
);
