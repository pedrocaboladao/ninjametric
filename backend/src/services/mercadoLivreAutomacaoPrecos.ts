import axios from "axios";
import { getValidAccessToken } from "./tokenStore";

// Automatização de preços NATIVA do Mercado Livre (doc oficial:
// developers.mercadolivre.com.br/pt_br/automatizacoes-de-precos). O painel não
// cria nem altera essas automatizações — testado ao vivo na Inga Collors, o
// ML não devolve nenhuma regra disponível (rules: []) pros anúncios da loja,
// nem pros de catálogo. O Repricing usa o robô próprio (repricingService.ts).
//
// Só interessa saber QUAIS anúncios têm a nativa ligada (criada pelo dono
// direto no ML), porque nesses o ML recusa mudança de preço por PUT /items
// (erro item.price.not_modifiable) e o robô precisa ficar de fora.

const ML_API_BASE = "https://api.mercadolibre.com";

export async function listarItensAutomatizados(lojaId: number, mlUserId: number): Promise<Set<string>> {
  const headers = { Authorization: `Bearer ${await getValidAccessToken(lojaId)}` };
  const ids = new Set<string>();
  for (let offset = 0; offset < 20_000; offset += 100) {
    const { data } = await axios.get<{ items: string[]; paging: { total: number } }>(
      `${ML_API_BASE}/pricing-automation/users/${mlUserId}/items`,
      { headers, params: { offset, limit: 100 } }
    );
    for (const id of data.items) ids.add(id);
    if (data.items.length === 0 || offset + 100 >= data.paging.total) break;
  }
  return ids;
}
