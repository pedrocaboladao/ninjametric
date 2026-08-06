import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória não definida: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  mlClientId: process.env.ML_CLIENT_ID ?? "",
  mlClientSecret: process.env.ML_CLIENT_SECRET ?? "",
  mlRedirectUri: process.env.ML_REDIRECT_URI ?? "",
  authUsername: required("AUTH_USERNAME"),
  authPasswordHash: required("AUTH_PASSWORD_HASH"),
  jwtSecret: required("JWT_SECRET"),
  // Opcional — sem ela, o Agentes IA (Analista de Ads) cai nas regras fixas
  // em vez da análise com IA de verdade.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
};
