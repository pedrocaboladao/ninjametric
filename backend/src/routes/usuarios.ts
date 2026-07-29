import { Router } from "express";
import { listarUsuarios, criarUsuario, atualizarUsuario, excluirUsuario, MODULOS_VALIDOS } from "../services/usuariosService";

export const usuariosRouter = Router();

function permissoesValidas(p: unknown): p is string[] {
  return Array.isArray(p) && p.every((m) => (MODULOS_VALIDOS as readonly string[]).includes(m));
}

usuariosRouter.get("/", async (_req, res) => {
  try {
    res.json({ usuarios: await listarUsuarios() });
  } catch (err) {
    console.error("Erro ao listar usuários:", err);
    res.status(500).json({ error: "Falha ao listar usuários." });
  }
});

usuariosRouter.post("/", async (req, res) => {
  const { username, senha, nome, permissoes } = req.body;
  if (
    typeof username !== "string" ||
    !username.trim() ||
    typeof senha !== "string" ||
    senha.length < 6 ||
    typeof nome !== "string" ||
    !nome.trim() ||
    !permissoesValidas(permissoes ?? [])
  ) {
    res.status(400).json({ error: "Dados inválidos. A senha precisa ter ao menos 6 caracteres." });
    return;
  }
  try {
    res.json(await criarUsuario(username.trim(), senha, nome.trim(), permissoes ?? []));
  } catch (err) {
    console.error("Erro ao criar usuário:", err);
    const duplicado = err instanceof Error && /duplicate|unique/i.test(err.message);
    res.status(400).json({ error: duplicado ? "Esse nome de usuário já existe." : "Falha ao criar usuário." });
  }
});

usuariosRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { nome, senha, permissoes } = req.body;
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  if (senha !== undefined && (typeof senha !== "string" || senha.length < 6)) {
    res.status(400).json({ error: "A senha precisa ter ao menos 6 caracteres." });
    return;
  }
  if (permissoes !== undefined && !permissoesValidas(permissoes)) {
    res.status(400).json({ error: "Permissões inválidas." });
    return;
  }
  try {
    await atualizarUsuario(id, { nome, senha, permissoes });
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao atualizar usuário:", err);
    res.status(400).json({ error: "Falha ao atualizar usuário." });
  }
});

usuariosRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Parâmetros inválidos." });
    return;
  }
  try {
    await excluirUsuario(id);
    res.json({ ok: true });
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : "Falha ao excluir usuário.";
    res.status(400).json({ error: mensagem });
  }
});
