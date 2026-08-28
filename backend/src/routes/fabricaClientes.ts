import { Router, Request, Response } from "express";
import {
  listarClientes,
  obterCliente,
  criarCliente,
  atualizarCliente,
  excluirCliente,
  type ClienteEntrada,
} from "../services/fabricaClientesService";

export const fabricaClientesRouter = Router();

function erro(res: Response, err: unknown, padrao: string) {
  console.error("[fabrica-clientes]", err);
  res.status(400).json({ error: err instanceof Error && err.message ? err.message : padrao });
}

// campo de texto opcional: string vazia vira null, pra não guardar "" e ""
// competirem com null nas checagens de cadastro incompleto
function texto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function lerEntrada(req: Request): ClienteEntrada | string {
  const b = req.body ?? {};
  if (typeof b.nome !== "string" || !b.nome.trim()) return "Informe o nome do cliente.";
  const tipo = b.tipo === "EXTERNO" ? "EXTERNO" : "LOJA";
  const uf = texto(b.uf);
  if (uf && uf.length !== 2) return "UF deve ter 2 letras.";
  return {
    nome: b.nome.trim(),
    tipo,
    cnpj: texto(b.cnpj),
    inscricaoEstadual: texto(b.inscricaoEstadual),
    email: texto(b.email),
    telefone: texto(b.telefone),
    cep: texto(b.cep),
    logradouro: texto(b.logradouro),
    numero: texto(b.numero),
    complemento: texto(b.complemento),
    bairro: texto(b.bairro),
    cidade: texto(b.cidade),
    uf: uf ? uf.toUpperCase() : null,
    observacao: texto(b.observacao),
    ativo: b.ativo !== false,
    // quem paga por esta loja. Zero e vazio viram null: a própria loja paga.
    clientePaiId:
      Number.isInteger(Number(b.clientePaiId)) && Number(b.clientePaiId) > 0
        ? Number(b.clientePaiId)
        : null,
    pessoaFisica: b.pessoaFisica === true,
  };
}

fabricaClientesRouter.get("/", async (_req, res) => {
  try {
    res.json({ clientes: await listarClientes() });
  } catch (err) {
    erro(res, err, "Falha ao carregar clientes.");
  }
});

fabricaClientesRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  try {
    const cliente = await obterCliente(id);
    if (!cliente) return res.status(404).json({ error: "Cliente não encontrado." });
    res.json(cliente);
  } catch (err) {
    erro(res, err, "Falha ao buscar cliente.");
  }
});

fabricaClientesRouter.post("/", async (req, res) => {
  const entrada = lerEntrada(req);
  if (typeof entrada === "string") return res.status(400).json({ error: entrada });
  try {
    res.status(201).json(await criarCliente(entrada));
  } catch (err) {
    erro(res, err, "Falha ao criar cliente.");
  }
});

fabricaClientesRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  const entrada = lerEntrada(req);
  if (typeof entrada === "string") return res.status(400).json({ error: entrada });
  try {
    await atualizarCliente(id, entrada);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao atualizar cliente.");
  }
});

fabricaClientesRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido." });
  try {
    await excluirCliente(id);
    res.status(204).end();
  } catch (err) {
    erro(res, err, "Falha ao excluir cliente.");
  }
});
