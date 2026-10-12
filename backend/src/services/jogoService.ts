import { pool } from "../db/pool";
import { dataISOBR } from "./dateUtils";
import { semanaDe } from "./agendaOcorrencias";

// Só pra brincadeira interna do time — 2 tentativas por usuário por semana
// (segunda a domingo, mesma semana da Agenda), vale a MAIOR pontuação da
// semana, não a soma.
export const TENTATIVAS_POR_SEMANA = 2;

export interface LinhaRankingJogo {
  usuarioId: number;
  nome: string;
  pontuacao: number;
  eu: boolean;
}

export interface SemanaJogo {
  inicioSemana: string;
  fimSemana: string;
  tentativasUsadas: number;
  tentativasMaximas: number;
  ranking: LinhaRankingJogo[];
}

function semanaAtual(): { inicioSemana: string; fimSemana: string } {
  const hoje = dataISOBR(new Date());
  return semanaDe(hoje);
}

export async function obterSemanaJogo(usuarioId: number): Promise<SemanaJogo> {
  const { inicioSemana, fimSemana } = semanaAtual();

  const { rows: usadasRows } = await pool.query<{ total: number }>(
    "SELECT COUNT(*)::int AS total FROM jogo_tentativas WHERE usuario_id = $1 AND dia BETWEEN $2 AND $3",
    [usuarioId, inicioSemana, fimSemana]
  );

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

  return {
    inicioSemana,
    fimSemana,
    tentativasUsadas: usadasRows[0].total,
    tentativasMaximas: TENTATIVAS_POR_SEMANA,
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
  const { inicioSemana, fimSemana } = semanaAtual();

  const { rows: usadasRows } = await pool.query<{ total: number }>(
    "SELECT COUNT(*)::int AS total FROM jogo_tentativas WHERE usuario_id = $1 AND dia BETWEEN $2 AND $3",
    [usuarioId, inicioSemana, fimSemana]
  );
  if (usadasRows[0].total >= TENTATIVAS_POR_SEMANA) {
    throw new Error("Suas tentativas dessa semana já acabaram.");
  }

  await pool.query("INSERT INTO jogo_tentativas (usuario_id, pontuacao, dia) VALUES ($1, $2, $3)", [
    usuarioId,
    pontuacao,
    dataISOBR(new Date()),
  ]);

  return obterSemanaJogo(usuarioId);
}
