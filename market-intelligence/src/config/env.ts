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
  port: Number(process.env.PORT ?? 4100),
  marketDatabaseUrl: required("MARKET_DATABASE_URL"),
  internalServiceKey: required("INTERNAL_SERVICE_KEY"),
  mlCoreInternalUrl: required("ML_CORE_INTERNAL_URL"),
  // Opcional — sem ela, busca de mercado fica indisponível (erro claro),
  // mas o serviço sobe normal (cadastro/consulta de keywords já cadastradas
  // continua funcionando).
  geckoApiKey: process.env.GECKO_API_KEY ?? "",
  // Trava simples de custo — acima disso, novas buscas pagas são recusadas
  // até o dia seguinte, ver searchService.ts.
  marketMaxRequestsDay: Number(process.env.MARKET_MAX_REQUESTS_DAY ?? 50),
};
