import { pool } from "../db/pool";
import { refreshAccessToken, MlTokenResponse } from "./mercadoLivreAuth";

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface Loja {
  id: number;
  nome: string;
  ml_user_id: number | null;
  imposto_percentual: number;
}

export async function listLojas(): Promise<Loja[]> {
  const { rows } = await pool.query<{ id: number; nome: string; ml_user_id: number | null; imposto_percentual: string }>(
    "SELECT id, nome, ml_user_id, imposto_percentual FROM lojas ORDER BY id"
  );
  // NUMERIC do Postgres volta como string pro driver não perder precisão —
  // convertendo aqui uma vez só, pra quem consome não precisar lembrar disso.
  return rows.map((r) => ({ ...r, imposto_percentual: Number(r.imposto_percentual) }));
}

export async function atualizarImpostoLoja(lojaId: number, impostoPercentual: number): Promise<void> {
  await pool.query("UPDATE lojas SET imposto_percentual = $1 WHERE id = $2", [impostoPercentual, lojaId]);
}

export async function saveTokens(lojaId: number, token: MlTokenResponse): Promise<void> {
  const expiraEm = new Date(Date.now() + token.expires_in * 1000);
  await pool.query(
    `INSERT INTO contas_ml (loja_id, access_token, refresh_token, expira_em, atualizado_em)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (loja_id)
     DO UPDATE SET access_token = $2, refresh_token = $3, expira_em = $4, atualizado_em = now()`,
    [lojaId, token.access_token, token.refresh_token, expiraEm]
  );
}

export async function getValidAccessToken(lojaId: number): Promise<string> {
  const { rows } = await pool.query<{
    access_token: string;
    refresh_token: string;
    expira_em: Date;
  }>(
    "SELECT access_token, refresh_token, expira_em FROM contas_ml WHERE loja_id = $1",
    [lojaId]
  );

  const conta = rows[0];
  if (!conta) {
    throw new Error(`Loja ${lojaId} não possui token do Mercado Livre. Autorize a conta primeiro.`);
  }

  const expiraEmMs = new Date(conta.expira_em).getTime();
  if (expiraEmMs - Date.now() > REFRESH_MARGIN_MS) {
    return conta.access_token;
  }

  const refreshed = await refreshAccessToken(conta.refresh_token);
  await saveTokens(lojaId, refreshed);
  return refreshed.access_token;
}
