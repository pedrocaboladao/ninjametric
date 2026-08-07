import { pool } from "../db/pool";
import { listLojas } from "./tokenStore";
import { searchOrders } from "./mercadoLivreApi";
import { janelaUltimosDias } from "./dateUtils";

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

// Recalcula do zero e substitui a lista inteira — é sempre "a leitura de
// hoje", não faz sentido acumular histórico de oportunidades passadas.
export async function verificarOportunidades(): Promise<void> {
  const vendas = await calcularVendasPorSku();
  const candidatos = vendas
    .filter((v) => v.quantidadeGrupo >= QUANTIDADE_MINIMA_GRUPO)
    .sort((a, b) => b.quantidadeGrupo - b.quantidadeMinhasLojas - (a.quantidadeGrupo - a.quantidadeMinhasLojas))
    .slice(0, LIMITE_OPORTUNIDADES);

  await pool.query("DELETE FROM agente_oportunidades");
  for (const c of candidatos) {
    await pool.query(
      `INSERT INTO agente_oportunidades (sku, titulo, quantidade_grupo, quantidade_minhas_lojas, contexto)
       VALUES ($1, $2, $3, $4, $5)`,
      [c.sku, c.titulo, c.quantidadeGrupo, c.quantidadeMinhasLojas, gerarContexto(c)]
    );
  }
}

const INTERVALO_MS = 24 * 60 * 60 * 1000; // 1x por dia — dado de venda não muda tão rápido quanto Ads

export function iniciarVerificacaoOportunidades(): void {
  async function verificar() {
    try {
      await verificarOportunidades();
      console.log("Agente de Oportunidades: lista atualizada.");
    } catch (err) {
      console.error("Erro na verificação do Agente de Oportunidades:", err);
    }
  }
  verificar();
  setInterval(verificar, INTERVALO_MS);
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
     ORDER BY (quantidade_grupo - quantidade_minhas_lojas) DESC`
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
