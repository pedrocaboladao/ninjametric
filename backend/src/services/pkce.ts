import crypto from "crypto";

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function generatePkcePair(): PkcePair {
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32));
  const codeChallenge = base64UrlEncode(crypto.createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

const verifiersPorState = new Map<string, string>();

export function guardarCodeVerifier(state: string, codeVerifier: string): void {
  verifiersPorState.set(state, codeVerifier);
}

export function consumirCodeVerifier(state: string): string | undefined {
  const verifier = verifiersPorState.get(state);
  verifiersPorState.delete(state);
  return verifier;
}
