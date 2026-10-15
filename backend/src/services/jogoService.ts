import { pool } from "../db/pool";
import { dataISOBR } from "./dateUtils";
import { semanaDe } from "./agendaOcorrencias";

// Só pra brincadeira interna do time — 2 tentativas por usuário POR DIA (dia
// do calendário de Maringá). O ranking continua semanal (segunda a domingo,
// mesma semana da Agenda) e vale a MAIOR pontuação da semana, não a soma.
export const TENTATIVAS_POR_DIA = 2;

export interface LinhaRankingJogo {
  usuarioId: number;
  nome: string;
  pontuacao: number;
  eu: boolean;
}

export interface RecordeJogo {
  usuarioId: number;
  nome: string;
  pontuacao: number;
  dia: string;
  eu: boolean;
}

export interface SemanaJogo {
  inicioSemana: string;
  fimSemana: string;
  tentativasUsadas: number;
  tentativasMaximas: number;
  ranking: LinhaRankingJogo[];
  // Maior pontuação de todos os tempos (não só da semana) — null se ninguém
  // jogou ainda. Empate: vale quem chegou nessa pontuação primeiro.
  recorde: RecordeJogo | null;
}

function semanaAtual(): { inicioSemana: string; fimSemana: string } {
  const hoje = dataISOBR(new Date());
  return semanaDe(hoje);
}

async function contarTentativasDeHoje(usuarioId: number): Promise<number> {
  const { rows } = await pool.query<{ total: number }>(
    "SELECT COUNT(*)::int AS total FROM jogo_tentativas WHERE usuario_id = $1 AND dia = $2",
    [usuarioId, dataISOBR(new Date())]
  );
  return rows[0].total;
}

export async function obterSemanaJogo(usuarioId: number): Promise<SemanaJogo> {
  const { inicioSemana, fimSemana } = semanaAtual();

  const tentativasUsadas = await contarTentativasDeHoje(usuarioId);

  const { rows: rankingRows } = await pool.query<{ usuario_id: number; nome: string; pontuacao: number }>(
    `SELECT t.usuario_id, u.nome, MAX(t.pontuacao) AS pontuacao
     FROM jogo_tentativas t
     JOIN usuarios u ON u.id = t.usuario_id
     WHERE t.dia BETWEEN $1 AND $2
     GROUP BY t.usuario_id, u.nome
     ORDER BY pontuacao DESC, u.nome
     LIMIT 50`,
    [inicioSemana, fimSemana]
  );

  const { rows: recordeRows } = await pool.query<{
    usuario_id: number;
    nome: string;
    pontuacao: number;
    dia: string;
  }>(
    `SELECT t.usuario_id, u.nome, t.pontuacao, to_char(t.dia, 'YYYY-MM-DD') AS dia
     FROM jogo_tentativas t
     JOIN usuarios u ON u.id = t.usuario_id
     ORDER BY t.pontuacao DESC, t.dia ASC, t.id ASC
     LIMIT 1`
  );
  const recorde = recordeRows[0]
    ? {
        usuarioId: recordeRows[0].usuario_id,
        nome: recordeRows[0].nome,
        pontuacao: recordeRows[0].pontuacao,
        dia: recordeRows[0].dia,
        eu: recordeRows[0].usuario_id === usuarioId,
      }
    : null;

  return {
    inicioSemana,
    fimSemana,
    recorde,
    tentativasUsadas,
    tentativasMaximas: TENTATIVAS_POR_DIA,
    ranking: rankingRows.map((r) => ({
      usuarioId: r.usuario_id,
      nome: r.nome,
      pontuacao: r.pontuacao,
      eu: r.usuario_id === usuarioId,
    })),
  };
}

export async function registrarTentativaJogo(usuarioId: number, pontuacao: number): Promise<SemanaJogo> {
  if (!Number.isInteger(pontuacao) || pontuacao < 0 || pontuacao > 100000) {
    throw new Error("Pontuação inválida.");
  }
  if ((await contarTentativasDeHoje(usuarioId)) >= TENTATIVAS_POR_DIA) {
    throw new Error("Suas tentativas de hoje já acabaram. Volta amanhã!");
  }

  await pool.query("INSERT INTO jogo_tentativas (usuario_id, pontuacao, dia) VALUES ($1, $2, $3)", [
    usuarioId,
    pontuacao,
    dataISOBR(new Date()),
  ]);

  return obterSemanaJogo(usuarioId);
}
