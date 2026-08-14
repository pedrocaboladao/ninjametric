import axios from "axios";
import { pool } from "./pool";
import { getValidAccessToken } from "../services/tokenStore";

const TERMO_TESTE = "tinta emborrachada 18kg";

async function testar() {
  const { rows } = await pool.query<{ loja_id: number }>("SELECT loja_id FROM contas_ml LIMIT 1");
  if (rows.length === 0) {
    console.log("Nenhuma loja com token do Mercado Livre encontrada — não dá pra testar.");
    await pool.end();
    return;
  }
  const lojaId = rows[0].loja_id;
  console.log(`Usando token da loja ${lojaId} pra testar...`);

  const token = await getValidAccessToken(lojaId);

  try {
    const { data, status } = await axios.get("https://api.mercadolibre.com/sites/MLB/search", {
      params: { q: TERMO_TESTE, limit: 5 },
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log("STATUS:", status);
    console.log("RESULTADOS ENCONTRADOS:", data.results?.length ?? 0);
    for (const item of (data.results ?? []).slice(0, 5)) {
      console.log(`- ${item.title} | R$ ${item.price} | vendedor: ${item.seller?.nickname ?? item.seller_id} | ${item.permalink}`);
    }
  } catch (err: any) {
    console.log("FALHOU");
    console.log("STATUS:", err.response?.status);
    console.log("BODY:", JSON.stringify(err.response?.data));
  }

  await pool.end();
}

testar().catch((err) => {
  console.error("Erro no teste:", err);
  process.exit(1);
});
