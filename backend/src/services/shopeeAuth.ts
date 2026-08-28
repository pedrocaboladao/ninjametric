import axios from "axios";
import crypto from "node:crypto";
import { pool } from "../db/pool";
import { env } from "../config/env";

// Fase 1, sandbox. Diferença central pra Mercado Livre/Bling: TODA chamada
// (não só o login) precisa de uma assinatura HMAC-SHA256 calculada na hora
// — não é um token simples no header. Confirmado ao vivo (a Shopee aceitou
// e redirecionou pra tela de login em vez de rejeitar com erro de
// assinatura) que a fórmula é:
//   sign = HMAC-SHA256(partner_id + path + timestamp [+ access_token] [+ shop_id], partner_key)
//
// O link de autorização (/api/v2/shop/auth_partner) não tem parâmetro
// "state" como o Mercado Livre tem — pra saber qual loja nossa iniciou a
// autorização, a informação vai embutida no próprio "redirect" que a gente
// controla (o sign não depende do conteúdo do redirect).

const FOLGA_SEGUNDOS = 300;

function configurado(): boolean {
  return Boolean(env.shopeePartnerId && env.shopeePartnerKey);
}

function exigirConfig(): void {
  if (!configurado()) {
    throw new Error("SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY não configurados no .env do backend.");
  }
}

function assinar(path: string, timestamp: number, accessToken?: string, shopId?: number): string {
  const base = `${env.shopeePartnerId}${path}${timestamp}${accessToken ?? ""}${shopId ?? ""}`;
  return crypto.createHmac("sha256", env.shopeePartnerKey).update(base).digest("hex");
}

export function urlDeAutorizacao(lojaId: number): string {
  exigirConfig();
  const path = "/api/v2/shop/auth_partner";
  const timestamp = Math.floor(Date.now() / 1000);
  const redirect = `${env.shopeeRedirectBase}/api/shopee/callback?lojaId=${lojaId}`;
  const url = new URL(`${env.shopeeBaseUrl}${path}`);
  url.searchParams.set("partner_id", env.shopeePartnerId);
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("redirect", redirect);
  url.searchParams.set("sign", assinar(path, timestamp));
  return url.toString();
}

export interface ShopeeToken {
  access_token: string;
  refresh_token: string;
  expire_in: number;
}

interface ShopeeErro {
  error?: string;
  message?: string;
}

async function pedirToken(path: string, corpo: Record<string, unknown>): Promise<ShopeeToken> {
  exigirConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const url = new URL(`${env.shopeeBaseUrl}${path}`);
  url.searchParams.set("partner_id", env.shopeePartnerId);
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", assinar(path, timestamp));

  try {
    const { data } = await axios.post<ShopeeToken & ShopeeErro>(url.toString(), corpo, {
      headers: { "Content-Type": "application/json" },
      timeout: 20000,
    });
    if (data.error) {
      throw new Error(`Shopee respondeu erro "${data.error}": ${data.message ?? "sem detalhe"}`);
    }
    return data;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      const d = err.response.data as ShopeeErro;
      throw new Error(`Shopee respondeu ${err.response.status}: ${d.error ?? ""} ${d.message ?? JSON.stringify(d)}`.trim());
    }
    throw err;
  }
}

export async function trocarCodigo(code: string, shopId: number): Promise<ShopeeToken> {
  return pedirToken("/api/v2/auth/token/get", {
    code,
    partner_id: Number(env.shopeePartnerId),
    shop_id: shopId,
  });
}

export async function renovar(refreshToken: string, shopId: number): Promise<ShopeeToken> {
  return pedirToken("/api/v2/auth/access_token/get", {
    refresh_token: refreshToken,
    partner_id: Number(env.shopeePartnerId),
    shop_id: shopId,
  });
}

export async function salvarToken(lojaId: number, shopId: number, token: ShopeeToken): Promise<void> {
  const expiraEm = new Date(Date.now() + token.expire_in * 1000);
  await pool.query(
    `INSERT INTO contas_shopee (loja_id, shop_id, access_token, refresh_token, expira_em, atualizado_em)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (loja_id)
     DO UPDATE SET shop_id = $2, access_token = $3, refresh_token = $4, expira_em = $5, atualizado_em = now()`,
    [lojaId, shopId, token.access_token, token.refresh_token, expiraEm]
  );
}

export interface ShopeeTokenValido {
  accessToken: string;
  shopId: number;
}

export async function tokenValido(lojaId: number): Promise<ShopeeTokenValido> {
  const { rows } = await pool.query<{
    shop_id: string;
    access_token: string;
    refresh_token: string;
    expira_em: Date;
  }>("SELECT shop_id, access_token, refresh_token, expira_em FROM contas_shopee WHERE loja_id = $1", [lojaId]);

  const conta = rows[0];
  if (!conta) {
    throw new Error(`Loja ${lojaId} não possui token da Shopee. Autorize a loja primeiro (GET /api/shopee/${lojaId}/autorizar).`);
  }

  const shopId = Number(conta.shop_id);
  const faltam = (new Date(conta.expira_em).getTime() - Date.now()) / 1000;
  if (faltam > FOLGA_SEGUNDOS) {
    return { accessToken: conta.access_token, shopId };
  }

  try {
    const novo = await renovar(conta.refresh_token, shopId);
    await salvarToken(lojaId, shopId, novo);
    return { accessToken: novo.access_token, shopId };
  } catch (err) {
    throw new Error(`A autorização da Shopee (loja ${lojaId}) expirou ou foi revogada. Autorize de novo.`);
  }
}

// Helper genérico pra chamadas assinadas já autenticadas — futuros serviços
// (pedidos, produtos) reaproveitam em vez de duplicar a lógica de
// assinatura. method "GET" manda params na query; "POST" manda no corpo
// (a Shopee sempre exige partner_id/timestamp/sign/access_token/shop_id na
// query mesmo em POST — só o resto do payload muda de lugar).
export async function chamarApiAssinada<T>(
  lojaId: number,
  path: string,
  params: Record<string, string | number> = {},
  method: "GET" | "POST" = "GET"
): Promise<T> {
  exigirConfig();
  const { accessToken, shopId } = await tokenValido(lojaId);
  const timestamp = Math.floor(Date.now() / 1000);
  const url = new URL(`${env.shopeeBaseUrl}${path}`);
  url.searchParams.set("partner_id", env.shopeePartnerId);
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("shop_id", String(shopId));
  url.searchParams.set("sign", assinar(path, timestamp, accessToken, shopId));

  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const { data } = await axios.get<T>(url.toString(), { timeout: 20000 });
    return data;
  }

  const { data } = await axios.post<T>(url.toString(), params, {
    headers: { "Content-Type": "application/json" },
    timeout: 20000,
  });
  return data;
}

export { configurado };
