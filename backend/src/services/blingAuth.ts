import axios from "axios";
import { pool } from "../db/pool";
import { env } from "../config/env";

// OAuth 2.0 do Bling, a API v3.
//
// Difere do Mercado Livre em dois pontos que custam tempo se passarem batido:
//
//   o /token exige Basic auth      client_id e secret vão no header em base64,
//                                  não no corpo como o ML faz
//   o code expira em 1 minuto      o callback tem que trocar na hora; guardar
//                                  pra trocar depois não funciona
//
// O token vive no banco, não em memória: o processo reinicia a cada deploy, e
// perder o refresh_token significa refazer a autorização na mão.

const AUTHORIZE = "https://www.bling.com.br/Api/v3/oauth/authorize";
const TOKEN = "https://www.bling.com.br/Api/v3/oauth/token";

// o access_token dura poucas horas; renova antes de estourar pra nenhuma
// chamada morrer no meio de uma sincronização
const FOLGA_SEGUNDOS = 300;

export interface BlingToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export function configurado(): boolean {
  return Boolean(env.blingClientId && env.blingClientSecret && env.blingRedirectUri);
}

function exigirConfig(): void {
  if (!configurado()) {
    throw new Error(
      "BLING_CLIENT_ID / BLING_CLIENT_SECRET / BLING_REDIRECT_URI não configurados no .env do backend."
    );
  }
}

function basic(): string {
  return Buffer.from(`${env.blingClientId}:${env.blingClientSecret}`).toString("base64");
}

export function urlDeAutorizacao(state: string): string {
  exigirConfig();
  const url = new URL(AUTHORIZE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.blingClientId);
  url.searchParams.set("redirect_uri", env.blingRedirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

async function pedirToken(corpo: Record<string, string>): Promise<BlingToken> {
  exigirConfig();
  try {
    const { data } = await axios.post<BlingToken>(TOKEN, new URLSearchParams(corpo), {
      headers: {
        Authorization: `Basic ${basic()}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      timeout: 20000,
    });
    return data;
  } catch (err) {
    // O Bling responde 400 com um corpo que diz o que está errado — código
    // expirado, redirect diferente do cadastrado, credencial inválida. Sem
    // repassar isso, todo problema vira "não deu para conectar" e a única
    // saída é adivinhar. O corpo não traz segredo: é a descrição do erro.
    if (axios.isAxiosError(err) && err.response) {
      const d = err.response.data as unknown;
      const texto = typeof d === "string" ? d : JSON.stringify(d);
      throw new Error(`Bling respondeu ${err.response.status}: ${texto.slice(0, 400)}`);
    }
    throw err;
  }
}

export async function trocarCodigo(code: string): Promise<BlingToken> {
  return pedirToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.blingRedirectUri,
  });
}

export async function renovar(refreshToken: string): Promise<BlingToken> {
  return pedirToken({ grant_type: "refresh_token", refresh_token: refreshToken });
}

export async function guardarToken(t: BlingToken): Promise<void> {
  await pool.query(
    `INSERT INTO fabrica_bling_token (id, access_token, refresh_token, expira_em, atualizado_em)
     VALUES (1, $1, $2, NOW() + ($3 || ' seconds')::interval, NOW())
     ON CONFLICT (id) DO UPDATE
       SET access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           expira_em = EXCLUDED.expira_em,
           atualizado_em = NOW()`,
    [t.access_token, t.refresh_token, String(t.expires_in ?? 21600)]
  );
}

export interface StatusBling {
  configurado: boolean;
  conectado: boolean;
  expiraEm: string | null;
  atualizadoEm: string | null;
  // refresh_token vence em 30 dias sem uso: avisa antes de virar problema
  diasParaVencer: number | null;
}

export async function status(): Promise<StatusBling> {
  const { rows } = await pool.query<{
    expira_em: string;
    atualizado_em: string;
  }>("SELECT expira_em, atualizado_em FROM fabrica_bling_token WHERE id = 1");
  if (!rows.length) {
    return {
      configurado: configurado(),
      conectado: false,
      expiraEm: null,
      atualizadoEm: null,
      diasParaVencer: null,
    };
  }
  const atualizado = new Date(rows[0].atualizado_em);
  const vence = new Date(atualizado.getTime() + 30 * 24 * 3600 * 1000);
  return {
    configurado: configurado(),
    conectado: true,
    expiraEm: rows[0].expira_em,
    atualizadoEm: rows[0].atualizado_em,
    diasParaVencer: Math.floor((vence.getTime() - Date.now()) / (24 * 3600 * 1000)),
  };
}

// Devolve um access_token válido, renovando se estiver perto de vencer.
export async function tokenValido(): Promise<string> {
  const { rows } = await pool.query<{
    access_token: string;
    refresh_token: string;
    expira_em: string;
  }>("SELECT access_token, refresh_token, expira_em FROM fabrica_bling_token WHERE id = 1");
  if (!rows.length) {
    throw new Error("O Bling ainda não foi conectado. Abra a tela de integração e autorize.");
  }
  const t = rows[0];
  const faltam = (new Date(t.expira_em).getTime() - Date.now()) / 1000;
  if (faltam > FOLGA_SEGUNDOS) return t.access_token;

  try {
    const novo = await renovar(t.refresh_token);
    await guardarToken(novo);
    return novo.access_token;
  } catch (err) {
    // refresh vencido ou revogado: quem resolve é refazer a autorização, e
    // dizer isso é mais útil que devolver 401 cru da API
    throw new Error(
      "A autorização do Bling expirou. Abra a tela de integração e autorize de novo."
    );
  }
}

export async function desconectar(): Promise<void> {
  await pool.query("DELETE FROM fabrica_bling_token WHERE id = 1");
}
