import { pool } from "../db/pool";
import { dataISOBR } from "./dateUtils";
import { semanaDe } from "./agendaOcorrencias";
import type { PlanoDeAcaoControleAds } from "./controleAdsAcoesService";

// O plano de ação por IA custa caro (Opus + thinking). Só o dono usa à
// vontade; todo mundo mais tem 1 geração por semana (segunda a domingo).
const USUARIO_SEM_LIMITE = "pedroca";

export function planoSemLimite(usuario: { username: string }): boolean {
  return usuario.username === USUARIO_SEM_LIMITE;
}

export interface StatusPlanoAds {
  ilimitado: boolean;
  usado: boolean;
  // Segunda-feira em que a próxima geração é liberada (null se ilimitado).
  liberaEm: string | null;
  // Último plano gerado nesta semana, pra rever sem gastar de novo.
  ultimo: { plano: PlanoDeAcaoControleAds; inicio: string; fim: string; lojaId: number | null; geradoEm: string } | null;
}

function proximaSegunda(fimSemana: string): string {
  const [y, m, d] = fimSemana.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

export async function obterStatusPlano(usuario: { id: number; username: string }): Promise<StatusPlanoAds> {
  if (planoSemLimite(usuario)) return { ilimitado: true, usado: false, liberaEm: null, ultimo: null };
  const { inicioSemana, fimSemana } = semanaDe(dataISOBR(new Date()));
  const { rows } = await pool.query<{
    plano: PlanoDeAcaoControleAds | null;
    inicio: string;
    fim: string;
    loja_id: number | null;
    gerado_em: string;
  }>(
    `SELECT plano, to_char(periodo_inicio, 'YYYY-MM-DD') AS inicio, to_char(periodo_fim, 'YYYY-MM-DD') AS fim,
            loja_id, to_char(dia, 'YYYY-MM-DD') AS gerado_em
     FROM controle_ads_planos
     WHERE usuario_id = $1 AND dia BETWEEN $2 AND $3
     ORDER BY id DESC LIMIT 1`,
    [usuario.id, inicioSemana, fimSemana]
  );
  const linha = rows[0];
  return {
    ilimitado: false,
    usado: !!linha,
    liberaEm: proximaSegunda(fimSemana),
    ultimo:
      linha && linha.plano
        ? { plano: linha.plano, inicio: linha.inicio, fim: linha.fim, lojaId: linha.loja_id, geradoEm: linha.gerado_em }
        : null,
  };
}

// Reserva a vaga da semana ANTES de chamar a IA (um INSERT só, então dois
// cliques/abas ao mesmo tempo não passam os dois). Devolve o id da reserva,
// ou liberado=false se a semana já foi usada. Usuário sem limite não reserva.
export async function reservarPlano(
  usuario: { id: number; username: string },
  inicio: string,
  fim: string,
  lojaId: number | undefined
): Promise<{ id: number | null; liberado: boolean }> {
  if (planoSemLimite(usuario)) return { id: null, liberado: true };
  const hoje = dataISOBR(new Date());
  const { inicioSemana, fimSemana } = semanaDe(hoje);
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO controle_ads_planos (usuario_id, dia, periodo_inicio, periodo_fim, loja_id)
     SELECT $1, $2, $3, $4, $5
     WHERE NOT EXISTS (
       SELECT 1 FROM controle_ads_planos WHERE usuario_id = $1 AND dia BETWEEN $6 AND $7
     )
     RETURNING id`,
    [usuario.id, hoje, inicio, fim, lojaId ?? null, inicioSemana, fimSemana]
  );
  return rows[0] ? { id: rows[0].id, liberado: true } : { id: null, liberado: false };
}

export async function concluirReserva(id: number | null, plano: PlanoDeAcaoControleAds): Promise<void> {
  if (id === null) return;
  await pool.query("UPDATE controle_ads_planos SET plano = $2 WHERE id = $1", [id, JSON.stringify(plano)]);
}

// Geração falhou: devolve a vaga da semana.
export async function cancelarReserva(id: number | null): Promise<void> {
  if (id === null) return;
  await pool.query("DELETE FROM controle_ads_planos WHERE id = $1", [id]).catch(() => undefined);
}
