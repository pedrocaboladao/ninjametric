import { pool } from "./pool";
import { chamarApiAssinada } from "../services/shopeeAuth";

const ORDER_SN = "260829MD7RM383";

async function main() {
  const { rows } = await pool.query<{ loja_id: number }>(
    "SELECT loja_id FROM contas_shopee LIMIT 1"
  );
  if (rows.length === 0) {
    console.log("Nenhuma loja com conta Shopee configurada.");
    await pool.end();
    return;
  }
  const lojaId = rows[0].loja_id;

  const data = await chamarApiAssinada<unknown>(lojaId, "/api/v2/payment/get_escrow_detail", {
    order_sn: ORDER_SN,
  });
  console.log(JSON.stringify(data, null, 2));

  await pool.end();
}

main().catch((err) => {
  console.error("Falha:", err);
  process.exit(1);
});
