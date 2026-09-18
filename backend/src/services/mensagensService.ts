import { pool } from "../db/pool";

export interface UsuarioBasico {
  id: number;
  nome: string;
}

export interface Conversa {
  usuario: UsuarioBasico;
  ultimaMensagem: string;
  ultimaMensagemEm: string;
  enviadaPorMim: boolean;
  naoLidas: number;
}

export interface Mensagem {
  id: number;
  remetenteId: number;
  destinatarioId: number;
  texto: string;
  lida: boolean;
  criadoEm: string;
}

// Todo mundo que já tem login pode ser destinatário — não filtra por loja
// nem permissão específica (mesmo espírito aberto de Discrepâncias): é uma
// lista de pessoas pra começar uma conversa, não um dado sensível.
export async function listarUsuariosParaConversa(usuarioAtualId: number): Promise<UsuarioBasico[]> {
  const { rows } = await pool.query<UsuarioBasico>(
    "SELECT id, nome FROM usuarios WHERE id != $1 ORDER BY nome",
    [usuarioAtualId]
  );
  return rows;
}

// Uma "conversa" é derivada, não uma tabela própria — agrupa mensagens pelo
// outro participante e pega a mais recente de cada grupo. DISTINCT ON exige
// que os campos do ORDER BY comecem pela mesma coluna do DISTINCT ON, por
// isso a subquery calcula "outro_id" antes de agrupar.
export async function listarConversas(usuarioId: number): Promise<Conversa[]> {
  const { rows } = await pool.query<{
    outro_id: number;
    outro_nome: string;
    texto: string;
    criado_em: string;
    remetente_id: number;
    nao_lidas: string;
  }>(
    `WITH minhas_mensagens AS (
       SELECT
         CASE WHEN remetente_id = $1 THEN destinatario_id ELSE remetente_id END AS outro_id,
         remetente_id, texto, criado_em
       FROM mensagens
       WHERE remetente_id = $1 OR destinatario_id = $1
     ),
     ultima_por_conversa AS (
       SELECT DISTINCT ON (outro_id) outro_id, remetente_id, texto, criado_em
       FROM minhas_mensagens
       ORDER BY outro_id, criado_em DESC
     ),
     nao_lidas_por_conversa AS (
       SELECT remetente_id AS outro_id, COUNT(*) AS qtd
       FROM mensagens
       WHERE destinatario_id = $1 AND lida = false
       GROUP BY remetente_id
     )
     SELECT u.id AS outro_id, u.nome AS outro_nome, ult.texto, ult.criado_em,
            ult.remetente_id, COALESCE(nl.qtd, 0) AS nao_lidas
     FROM ultima_por_conversa ult
     JOIN usuarios u ON u.id = ult.outro_id
     LEFT JOIN nao_lidas_por_conversa nl ON nl.outro_id = ult.outro_id
     ORDER BY ult.criado_em DESC`,
    [usuarioId]
  );

  return rows.map((r) => ({
    usuario: { id: r.outro_id, nome: r.outro_nome },
    ultimaMensagem: r.texto,
    ultimaMensagemEm: r.criado_em,
    enviadaPorMim: r.remetente_id === usuarioId,
    naoLidas: Number(r.nao_lidas),
  }));
}

export async function contarNaoLidas(usuarioId: number): Promise<number> {
  const { rows } = await pool.query<{ total: string }>(
    "SELECT COUNT(*) AS total FROM mensagens WHERE destinatario_id = $1 AND lida = false",
    [usuarioId]
  );
  return Number(rows[0].total);
}

// Lê a conversa inteira com uma pessoa e já marca como lida (o dono abriu a
// tela, então viu) — mesmo padrão de "abrir = marcar como lido" de qualquer
// app de mensagem.
export async function listarMensagens(usuarioId: number, outroUsuarioId: number): Promise<Mensagem[]> {
  const { rows } = await pool.query<{
    id: number;
    remetente_id: number;
    destinatario_id: number;
    texto: string;
    lida: boolean;
    criado_em: string;
  }>(
    `SELECT id, remetente_id, destinatario_id, texto, lida, criado_em
     FROM mensagens
     WHERE (remetente_id = $1 AND destinatario_id = $2) OR (remetente_id = $2 AND destinatario_id = $1)
     ORDER BY criado_em ASC`,
    [usuarioId, outroUsuarioId]
  );

  await pool.query("UPDATE mensagens SET lida = true WHERE destinatario_id = $1 AND remetente_id = $2 AND lida = false", [
    usuarioId,
    outroUsuarioId,
  ]);

  return rows.map((r) => ({
    id: r.id,
    remetenteId: r.remetente_id,
    destinatarioId: r.destinatario_id,
    texto: r.texto,
    lida: r.lida,
    criadoEm: r.criado_em,
  }));
}

export async function enviarMensagem(remetenteId: number, destinatarioId: number, texto: string): Promise<Mensagem> {
  if (remetenteId === destinatarioId) {
    throw new Error("Não dá pra mandar mensagem pra você mesmo.");
  }
  const destinatario = await pool.query("SELECT 1 FROM usuarios WHERE id = $1", [destinatarioId]);
  if (destinatario.rowCount === 0) {
    throw new Error("Usuário não encontrado.");
  }

  const { rows } = await pool.query<{
    id: number;
    remetente_id: number;
    destinatario_id: number;
    texto: string;
    lida: boolean;
    criado_em: string;
  }>(
    `INSERT INTO mensagens (remetente_id, destinatario_id, texto) VALUES ($1, $2, $3)
     RETURNING id, remetente_id, destinatario_id, texto, lida, criado_em`,
    [remetenteId, destinatarioId, texto]
  );
  const r = rows[0];
  return {
    id: r.id,
    remetenteId: r.remetente_id,
    destinatarioId: r.destinatario_id,
    texto: r.texto,
    lida: r.lida,
    criadoEm: r.criado_em,
  };
}
