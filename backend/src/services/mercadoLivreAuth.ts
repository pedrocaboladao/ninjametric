import axios from "axios";
import { env } from "../config/env";

const ML_AUTH_URL = "https://auth.mercadolivre.com.br/authorization";
const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";

export interface MlTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  user_id: number;
  refresh_token: string;
}

function assertConfigured(): void {
  if (!env.mlClientId || !env.mlClientSecret || !env.mlRedirectUri) {
    throw new Error(
      "ML_CLIENT_ID / ML_CLIENT_SECRET / ML_REDIRECT_URI não configurados no .env do backend."
    );
  }
}

export function buildAuthorizationUrl(state: string, codeChallenge: string): string {
  assertConfigured();
  const url = new URL(ML_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.mlClientId);
  url.searchParams.set("redirect_uri", env.mlRedirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeCodeForToken(code: string, codeVerifier: string): Promise<MlTokenResponse> {
  assertConfigured();
  const { data } = await axios.post<MlTokenResponse>(
    ML_TOKEN_URL,
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: env.mlClientId,
      client_secret: env.mlClientSecret,
      code,
      redirect_uri: env.mlRedirectUri,
      code_verifier: codeVerifier,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return data;
}

export async function refreshAccessToken(refreshToken: string): Promise<MlTokenResponse> {
  assertConfigured();
  const { data } = await axios.post<MlTokenResponse>(
    ML_TOKEN_URL,
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.mlClientId,
      client_secret: env.mlClientSecret,
      refresh_token: refreshToken,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return data;
}
