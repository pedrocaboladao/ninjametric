import axios from "axios";
import crypto from "node:crypto";
import { pool } from "../db/pool";
import { env } from "../config/env";

// Espelha shopeeAuth.ts (mesma assinatura HMAC-SHA256, mesmo fluxo
// auth_partner), mas usando o Partner ID/Key do app SEPARADO "ADS impetrus
// vision" (categoria Ads Service) e a tabela contas_shopee_ads — o app
// principal não tem o escopo de Ads liberado por padrão, então cada loja
// precisa autorizar este segundo app além do primeiro.

const FOLGA_SEGUNDOS = 300;

function configurado(): boolean {
  return Boolean(env.shopeeAdsPartnerId && env.shopeeAdsPartnerKey);
}

function exigirConfig(): void {
  if (!configurado()) {
    throw new Error("SHOPEE_ADS_PARTNER_ID / SHOPEE_ADS_PARTNER_KEY não configurados no .env do backend.");
  }
}

function assinar(path: string, timestamp: number, accessToken?: string, shopId?: number): string {
  const base = `${env.shopeeAdsPartnerId}${path}${timestamp}${accessToken ?? ""}${shopId ?? ""}`;
  return crypto.createHmac("sha256", env.shopeeAdsPartnerKey).update(base).digest("hex");
}

export function urlDeAutorizacao(lojaId: number): string {
  exigirConfig();
  const path = "/api/v2/shop/auth_partner";
  const timestamp = Math.floor(Date.now() / 1000);
  const redirect = `${env.shopeeRedirectBase}/api/shopee-ads/callback?lojaId=${lojaId}`;
  const url = new URL(`${env.shopeeBaseUrl}${path}`);
  url.searchParams.set("partner_id", env.shopeeAdsPartnerId);
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
  url.searchParams.set("partner_id", env.shopeeAdsPartnerId);
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
    partner_id: Number(env.shopeeAdsPartnerId),
    shop_id: shopId,
  });
}

export async function renovar(refreshToken: string, shopId: number): Promise<ShopeeToken> {
  return pedirToken("/api/v2/auth/access_token/get", {
    refresh_token: refreshToken,
    partner_id: Number(env.shopeeAdsPartnerId),
    shop_id: shopId,
  });
}

export async function salvarToken(lojaId: number, shopId: number, token: ShopeeToken): Promise<void> {
  const expiraEm = new Date(Date.now() + token.expire_in * 1000);
  await pool.query(
    `INSERT INTO contas_shopee_ads (loja_id, shop_id, access_token, refresh_token, expira_em, atualizado_em)
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
  }>("SELECT shop_id, access_token, refresh_token, expira_em FROM contas_shopee_ads WHERE loja_id = $1", [lojaId]);

  const conta = rows[0];
  if (!conta) {
    throw new Error(`Loja ${lojaId} não possui token do app de Ads da Shopee. Autorize a loja primeiro (GET /api/shopee-ads/${lojaId}/autorizar).`);
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
    throw new Error(`A autorização do app de Ads da Shopee (loja ${lojaId}) expirou ou foi revogada. Autorize de novo.`);
  }
}

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
  url.searchParams.set("partner_id", env.shopeeAdsPartnerId);
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
