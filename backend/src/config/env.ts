import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória não definida: ${name}`);
  }
  return value;
}

// Origens liberadas a fazer requisição com cookie (CORS). Produção fixa +
// dev local — evita "origin: true" (reflete qualquer origem, na prática
// desliga a proteção de CORS pra requisições com credentials). Inclui as
// variações razoáveis do domínio (com/sem "www", http/https — o certbot já
// força redirect http->https, mas não custa cobrir) pra ninguém ficar
// travado por causa de como digitou o link. Dá pra somar mais origens via
// CORS_ORIGIN (separadas por vírgula) sem mudar código.
const CORS_ORIGINS_PADRAO = [
  "https://ninjametrics.cloud",
  "https://www.ninjametrics.cloud",
  "http://ninjametrics.cloud",
  "http://www.ninjametrics.cloud",
  "http://localhost:5173",
  "http://localhost:4000",
];

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  corsOrigins: process.env.CORS_ORIGIN
    ? [...CORS_ORIGINS_PADRAO, ...process.env.CORS_ORIGIN.split(",").map((o) => o.trim())]
    : CORS_ORIGINS_PADRAO,
  mlClientId: process.env.ML_CLIENT_ID ?? "",
  mlClientSecret: process.env.ML_CLIENT_SECRET ?? "",
  mlRedirectUri: process.env.ML_REDIRECT_URI ?? "",
  // Bling, o ERP da Fábrica. Fica vazio até alguém gerar o aplicativo lá:
  // sem isso a tela de integração diz o que falta em vez de derrubar o
  // backend na subida, que é como o Mercado Livre já se comporta aqui.
  blingClientId: process.env.BLING_CLIENT_ID ?? "",
  blingClientSecret: process.env.BLING_CLIENT_SECRET ?? "",
  blingRedirectUri: process.env.BLING_REDIRECT_URI ?? "",
  authUsername: required("AUTH_USERNAME"),
  authPasswordHash: required("AUTH_PASSWORD_HASH"),
  jwtSecret: required("JWT_SECRET"),
  // Opcional — sem ela, o Agentes IA (Analista de Ads) cai nas regras fixas
  // em vez da análise com IA de verdade.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  // Opcional — sem ela, o Agente de Imagens (tratar foto / criar arte) fica
  // indisponível, mas o resto do painel funciona normal.
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  // Opcional — sem ela, o bot de WhatsApp fica desligado (Growth Hacker
  // continua acessível normalmente pelo painel). Número autorizado a falar
  // com o bot, só dígitos em E.164 sem "+" (ex: "5511999999999") — qualquer
  // outro remetente é ignorado. Ver whatsappService.ts.
  whatsappOwnerNumber: process.env.WHATSAPP_OWNER_NUMBER ?? "",
  // Opcional — sem ela (ou sem internalServiceKey), a aba Inteligência de
  // Mercado responde erro claro em vez do backend inteiro falhar ao subir.
  marketIntelligenceUrl: process.env.MARKET_INTELLIGENCE_URL ?? "",
  // Chave de serviço interna compartilhada só com o market-intelligence —
  // não é segredo do ML nem do painel, existe só pra autenticar chamada
  // serviço-a-serviço nos dois sentidos (proxy e /internal/public-ml-items).
  internalServiceKey: process.env.INTERNAL_SERVICE_KEY ?? "",
  // Shopee Open Platform (fase 1 — sandbox). Opcional, mesmo motivo do
  // resto: sem essas vars, a integração fica indisponível em vez de
  // derrubar o backend inteiro. shopeeBaseUrl aponta pro sandbox por
  // padrão — troca só quando for pra produção de verdade (host diferente:
  // https://openplatform.shopee.com.br).
  shopeePartnerId: process.env.SHOPEE_PARTNER_ID ?? "",
  shopeePartnerKey: process.env.SHOPEE_PARTNER_KEY ?? "",
  shopeeBaseUrl: process.env.SHOPEE_BASE_URL ?? "https://openplatform.sandbox.test-stable.shopee.sg",
  shopeeRedirectBase: process.env.SHOPEE_REDIRECT_BASE ?? "https://ninjametrics.cloud",
};
