import { pool } from "../db/pool";
import { listLojas } from "./tokenStore";
import { searchOrders } from "./mercadoLivreApi";
import { janelaUltimosDias, chaveJanelaDoDia } from "./dateUtils";

// Só as 4 contas PESSOAIS do usuário (mesmas do Analista de Ads/Agente de
// Imagens) — IDs confirmados via GET /api/lojas/todas: Hangar=1, Catedral
// Impermeabilizantes=2, Inga Collors=3, Perpétua=4.
const MINHAS_LOJAS = [1, 2, 3, 4];
const DIAS_JANELA = 30;
const STATUS_VALIDOS = new Set(["paid", "confirmed"]);
// Ignora SKU com pouquíssimo volume total pra não gerar ruído com produto
// de nicho vendendo 2-3 unidades no grupo inteiro.
const QUANTIDADE_MINIMA_GRUPO = 10;
const LIMITE_OPORTUNIDADES = 15;

interface VendaPorSku {
  sku: string;
  titulo: string;
  quantidadeGrupo: number;
  quantidadeMinhasLojas: number;
}

// Soma vendas (últimos 30 dias, todas as lojas do grupo) agrupadas por SKU
// — reaproveita searchOrders (mesma função que Financeiro/Dashboard usam),
// só que numa janela maior e agregando por SKU em vez de por loja/dia.
async function calcularVendasPorSku(): Promise<VendaPorSku[]> {
  const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null);
  const janela = janelaUltimosDias(DIAS_JANELA);

  const porLoja = await Promise.all(
    lojas.map(async (loja) => ({
      lojaId: loja.id,
      orders: await searchOrders(loja.id, loja.ml_user_id as number, janela.inicioDia, janela.agora),
    }))
  );

  const mapa = new Map<string, VendaPorSku>();
  for (const { lojaId, orders } of porLoja) {
    for (const o of orders) {
      if (!STATUS_VALIDOS.has(o.status)) continue;
      for (const item of o.order_items) {
        const sku = item.item.seller_sku;
        if (!sku) continue;
        const atual = mapa.get(sku) ?? { sku, titulo: item.item.title, quantidadeGrupo: 0, quantidadeMinhasLojas: 0 };
        atual.quantidadeGrupo += item.quantity;
        if (MINHAS_LOJAS.includes(lojaId)) atual.quantidadeMinhasLojas += item.quantity;
        atual.titulo = item.item.title;
        mapa.set(sku, atual);
      }
    }
  }
  return Array.from(mapa.values());
}

function gerarContexto(v: VendaPorSku): string {
  if (v.quantidadeMinhasLojas === 0) {
    return `Vendeu ${v.quantidadeGrupo} unidades no grupo nos últimos ${DIAS_JANELA} dias, mas nenhuma nas suas lojas — pode ser uma oportunidade de adicionar ou dar mais destaque a esse produto.`;
  }
  const percentualSeu = (v.quantidadeMinhasLojas / v.quantidadeGrupo) * 100;
  return `Vendeu ${v.quantidadeGrupo} unidades no grupo nos últimos ${DIAS_JANELA} dias — você vendeu ${v.quantidadeMinhasLojas} (${percentualSeu.toFixed(
    0
  )}% do total), parece ter espaço pra crescer nas suas lojas.`;
}

// Compara com a lista anterior em vez de substituir tudo de uma vez: quem já
// estava na lista mantém o criado_em original (upsert por sku), só quem é
// genuinamente novo ganha timestamp novo, e quem não bate mais os critérios
// sai. Isso faz o feed crescer aos poucos ao longo do dia (a cada rodada só
// as novidades sobem), em vez de reescrever a lista inteira com o mesmo
// horário toda vez.
export async function verificarOportunidades(): Promise<void> {
  const vendas = await calcularVendasPorSku();
  const candidatos = vendas
    .filter((v) => v.quantidadeGrupo >= QUANTIDADE_MINIMA_GRUPO)
    .sort((a, b) => b.quantidadeGrupo - b.quantidadeMinhasLojas - (a.quantidadeGrupo - a.quantidadeMinhasLojas))
    .slice(0, LIMITE_OPORTUNIDADES);

  for (const c of candidatos) {
    await pool.query(
      `INSERT INTO agente_oportunidades (sku, titulo, quantidade_grupo, quantidade_minhas_lojas, contexto)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (sku) DO UPDATE
         SET titulo = EXCLUDED.titulo,
             quantidade_grupo = EXCLUDED.quantidade_grupo,
             quantidade_minhas_lojas = EXCLUDED.quantidade_minhas_lojas,
             contexto = EXCLUDED.contexto`,
      [c.sku, c.titulo, c.quantidadeGrupo, c.quantidadeMinhasLojas, gerarContexto(c)]
    );
  }

  const skusAtuais = candidatos.map((c) => c.sku);
  if (skusAtuais.length > 0) {
    await pool.query("DELETE FROM agente_oportunidades WHERE sku != ALL($1::text[])", [skusAtuais]);
  } else {
    await pool.query("DELETE FROM agente_oportunidades");
  }
}

const HORARIOS_VERIFICACAO = [6, 11, 16, 21]; // horário de Brasília — 4x/dia
const INTERVALO_CHECAGEM_HORARIO_MS = 5 * 60 * 1000; // 5min

export function iniciarVerificacaoOportunidades(): void {
  // Mesma técnica de "janela por horário-âncora" do Agente de Ads
  // (chaveJanelaDoDia, dateUtils.ts) — dispara uma vez por horário
  // cruzado, não uma vez por checagem. Começa já sincronizado com a
  // janela atual pra não rodar uma vez extra a cada reinício/deploy.
  let ultimaJanela = chaveJanelaDoDia(HORARIOS_VERIFICACAO);
  async function checar() {
    const janela = chaveJanelaDoDia(HORARIOS_VERIFICACAO);
    if (janela === ultimaJanela) return;
    ultimaJanela = janela;
    try {
      await verificarOportunidades();
      console.log(`Agente de Oportunidades: lista atualizada (janela ${janela}).`);
    } catch (err) {
      console.error("Erro na verificação do Agente de Oportunidades:", err);
    }
  }
  setInterval(checar, INTERVALO_CHECAGEM_HORARIO_MS);
}

export interface Oportunidade {
  id: number;
  sku: string;
  titulo: string;
  quantidadeGrupo: number;
  quantidadeMinhasLojas: number;
  contexto: string;
  criadoEm: string;
}

export async function listarOportunidades(): Promise<Oportunidade[]> {
  const { rows } = await pool.query<{
    id: number;
    sku: string;
    titulo: string;
    quantidade_grupo: number;
    quantidade_minhas_lojas: number;
    contexto: string;
    criado_em: string;
  }>(
    `SELECT id, sku, titulo, quantidade_grupo, quantidade_minhas_lojas, contexto, criado_em
     FROM agente_oportunidades
     ORDER BY criado_em DESC`
  );
  return rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    titulo: r.titulo,
    quantidadeGrupo: r.quantidade_grupo,
    quantidadeMinhasLojas: r.quantidade_minhas_lojas,
    contexto: r.contexto,
    criadoEm: r.criado_em,
  }));
}
