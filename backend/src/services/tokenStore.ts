import { pool } from "../db/pool";
import { refreshAccessToken, MlTokenResponse } from "./mercadoLivreAuth";

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface Loja {
  id: number;
  nome: string;
  ml_user_id: number | null;
  imposto_percentual: number;
  custo_fixo_mensal: number;
}

export async function listLojas(): Promise<Loja[]> {
  const { rows } = await pool.query<{
    id: number;
    nome: string;
    ml_user_id: number | null;
    imposto_percentual: string;
    custo_fixo_mensal: string;
  }>("SELECT id, nome, ml_user_id, imposto_percentual, custo_fixo_mensal FROM lojas ORDER BY id");
  // NUMERIC do Postgres volta como string pro driver não perder precisão —
  // convertendo aqui uma vez só, pra quem consome não precisar lembrar disso.
  return rows.map((r) => ({
    ...r,
    imposto_percentual: Number(r.imposto_percentual),
    custo_fixo_mensal: Number(r.custo_fixo_mensal),
  }));
}

export async function atualizarImpostoLoja(lojaId: number, impostoPercentual: number): Promise<void> {
  await pool.query("UPDATE lojas SET imposto_percentual = $1 WHERE id = $2", [impostoPercentual, lojaId]);
}

export async function atualizarCustoFixoLoja(lojaId: number, custoFixoMensal: number): Promise<void> {
  await pool.query("UPDATE lojas SET custo_fixo_mensal = $1 WHERE id = $2", [custoFixoMensal, lojaId]);
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

// Chamadas concorrentes pra mesma loja perto do vencimento do token (comum:
// Diretor de Ads, Controle de Ads, Gestão de Ads e o snapshot de 4h todos
// batem nas mesmas lojas) caíam numa corrida — cada uma lia o mesmo
// refresh_token do banco e tentava renovar ao mesmo tempo. O Mercado Livre
// invalida o refresh_token no primeiro uso, então a segunda chamada tomava
// erro (invalid_grant). Esse erro é engolido mais acima pelos catches que
// tratam "falha ao buscar Ads" igual a "loja sem dado" — na prática virava
// um card/resposta zerada que se resolvia sozinha ao tentar de novo, porque
// aí o token já tinha sido renovado pela outra chamada (ver reclamação de
// 07/10/2026 sobre o Diretor de Ads do Grupo vindo zerado pra "Pinta e
// Constrói" e se corrigindo na repetição). Dedup por loja: a segunda chamada
// só espera a primeira terminar, em vez de competir pelo mesmo refresh_token.
const renovacoesEmAndamento = new Map<number, Promise<string>>();

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

  const emAndamento = renovacoesEmAndamento.get(lojaId);
  if (emAndamento) return emAndamento;

  const promessa = (async () => {
    try {
      const refreshed = await refreshAccessToken(conta.refresh_token);
      await saveTokens(lojaId, refreshed);
      return refreshed.access_token;
    } finally {
      renovacoesEmAndamento.delete(lojaId);
    }
  })();
  renovacoesEmAndamento.set(lojaId, promessa);
  return promessa;
}
