import { pool } from "../db/pool";
import { listLojas } from "./tokenStore";
import {
  criarCampanhaVendedor,
  adicionarItemCampanha,
  obterStatusCampanha,
  getItemsBasicInfo,
} from "./mercadoLivreApi";

export interface ResultadoItemCampanha {
  itemId: string;
  ok: boolean;
  erro?: string;
  precoOriginal?: number;
  dealPrice?: number;
}

export interface ResultadoCriarCampanha {
  campanhaId: number;
  promotionId: string;
  nome: string;
  itens: ResultadoItemCampanha[];
}

export interface CampanhaItem {
  itemId: string;
  titulo: string | null;
  precoOriginal: number;
  dealPrice: number;
}

export interface Campanha {
  id: number;
  lojaId: number;
  lojaNome: string;
  promotionId: string;
  nome: string;
  percentualDesconto: number;
  dataInicio: string;
  dataFim: string;
  status: string;
  campanhaAnteriorId: number | null;
  itens: CampanhaItem[];
}

const PERCENTUAL_MINIMO = 10;
const PERCENTUAL_MAXIMO = 70;
const DIAS_CAMPANHA = 13; // hoje + 13 = 14 dias corridos, dentro do limite do ML

function arredondarCentavos(valor: number): number {
  return Math.round((valor + 1e-9) * 100) / 100;
}

function dataISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Cria a campanha no Mercado Livre e adiciona cada item, um por um — um
// item pode falhar por não ser elegível (reputação, condição, exposição
// paga) sem travar os outros; o resultado devolve sucesso/erro por item
// pra tela mostrar exatamente o que colou. Só grava no banco os itens que
// entraram de fato — a campanha em si é gravada mesmo com falhas parciais,
// já que ela existe de verdade no Mercado Livre a partir da criação.
export async function criarCampanha(
  lojaId: number,
  nome: string,
  percentualDesconto: number,
  itemIds: string[],
  campanhaAnteriorId: number | null = null
): Promise<ResultadoCriarCampanha> {
  if (percentualDesconto < PERCENTUAL_MINIMO || percentualDesconto > PERCENTUAL_MAXIMO) {
    throw new Error(`Percentual precisa ficar entre ${PERCENTUAL_MINIMO}% e ${PERCENTUAL_MAXIMO}%.`);
  }
  if (itemIds.length === 0) {
    throw new Error("Informe ao menos um item.");
  }

  const hoje = new Date();
  const fim = new Date(hoje.getTime() + DIAS_CAMPANHA * 24 * 60 * 60 * 1000);
  const dataInicio = dataISO(hoje);
  const dataFim = dataISO(fim);

  const campanhaMl = await criarCampanhaVendedor(lojaId, nome, dataInicio, dataFim);

  const precos = await getItemsBasicInfo(lojaId, itemIds);
  const itensResultado: ResultadoItemCampanha[] = [];

  for (const itemId of itemIds) {
    const info = precos.get(itemId);
    if (!info) {
      itensResultado.push({ itemId, ok: false, erro: "Anúncio não encontrado." });
      continue;
    }
    const dealPrice = arredondarCentavos(info.price * (1 - percentualDesconto / 100));
    try {
      await adicionarItemCampanha(lojaId, itemId, campanhaMl.id, dealPrice);
      itensResultado.push({ itemId, ok: true, precoOriginal: info.price, dealPrice });
    } catch (err) {
      const mensagem =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "Falha ao adicionar item — provavelmente não elegível (reputação, condição ou exposição do anúncio).";
      itensResultado.push({ itemId, ok: false, erro: mensagem });
    }
  }

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO promocoes_campanhas
       (loja_id, promotion_id, nome, percentual_desconto, data_inicio, data_fim, status, campanha_anterior_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [lojaId, campanhaMl.id, nome, percentualDesconto, dataInicio, dataFim, campanhaMl.status, campanhaAnteriorId]
  );
  const campanhaId = rows[0].id;

  for (const item of itensResultado) {
    if (!item.ok || item.precoOriginal === undefined || item.dealPrice === undefined) continue;
    const info = precos.get(item.itemId);
    await pool.query(
      `INSERT INTO promocoes_itens (campanha_id, item_id, titulo, preco_original, deal_price)
       VALUES ($1, $2, $3, $4, $5)`,
      [campanhaId, item.itemId, info?.title ?? null, item.precoOriginal, item.dealPrice]
    );
  }

  return { campanhaId, promotionId: campanhaMl.id, nome, itens: itensResultado };
}

// Lê a campanha antiga do banco e recria com o mesmo nome (+ sufixo de
// data, pra não bater no erro "name already exists" do Mercado Livre),
// mesmo percentual, mesmos itens — preço recalculado do zero em cima do
// preço ATUAL de cada item, não repete o preço antigo (pode estar
// desatualizado se o produto mudou de preço nesse meio tempo).
export async function recriarCampanha(campanhaAntigaId: number): Promise<ResultadoCriarCampanha> {
  const { rows } = await pool.query<{
    loja_id: number;
    nome: string;
    percentual_desconto: string;
  }>("SELECT loja_id, nome, percentual_desconto FROM promocoes_campanhas WHERE id = $1", [campanhaAntigaId]);
  if (rows.length === 0) throw new Error("Campanha não encontrada.");

  const { rows: itensRows } = await pool.query<{ item_id: string }>(
    "SELECT item_id FROM promocoes_itens WHERE campanha_id = $1",
    [campanhaAntigaId]
  );
  if (itensRows.length === 0) throw new Error("Essa campanha não tem itens registrados pra recriar.");

  const sufixo = ` (${dataISO(new Date()).split("-").reverse().slice(0, 2).join("/")})`;
  return criarCampanha(
    rows[0].loja_id,
    rows[0].nome + sufixo,
    Number(rows[0].percentual_desconto),
    itensRows.map((r) => r.item_id),
    campanhaAntigaId
  );
}

export async function listarCampanhas(lojaIdFiltro?: number, lojasPermitidas?: number[]): Promise<Campanha[]> {
  const lojas = (await listLojas()).filter(
    (l) => (lojaIdFiltro === undefined || l.id === lojaIdFiltro) && (lojasPermitidas === undefined || lojasPermitidas.includes(l.id))
  );
  const lojaIds = lojas.map((l) => l.id);
  if (lojaIds.length === 0) return [];

  const { rows } = await pool.query<{
    id: number;
    loja_id: number;
    loja_nome: string;
    promotion_id: string;
    nome: string;
    percentual_desconto: string;
    data_inicio: string;
    data_fim: string;
    status: string;
    campanha_anterior_id: number | null;
  }>(
    `SELECT c.id, c.loja_id, l.nome AS loja_nome, c.promotion_id, c.nome, c.percentual_desconto,
            c.data_inicio::text AS data_inicio, c.data_fim::text AS data_fim, c.status, c.campanha_anterior_id
     FROM promocoes_campanhas c
     JOIN lojas l ON l.id = c.loja_id
     WHERE c.loja_id = ANY($1)
     ORDER BY c.data_fim ASC`,
    [lojaIds]
  );

  const itensPorCampanha = new Map<number, CampanhaItem[]>();
  if (rows.length > 0) {
    const { rows: itensRows } = await pool.query<{
      campanha_id: number;
      item_id: string;
      titulo: string | null;
      preco_original: string;
      deal_price: string;
    }>(
      "SELECT campanha_id, item_id, titulo, preco_original, deal_price FROM promocoes_itens WHERE campanha_id = ANY($1)",
      [rows.map((r) => r.id)]
    );
    for (const r of itensRows) {
      if (!itensPorCampanha.has(r.campanha_id)) itensPorCampanha.set(r.campanha_id, []);
      itensPorCampanha.get(r.campanha_id)!.push({
        itemId: r.item_id,
        titulo: r.titulo,
        precoOriginal: Number(r.preco_original),
        dealPrice: Number(r.deal_price),
      });
    }
  }

  return rows.map((r) => ({
    id: r.id,
    lojaId: r.loja_id,
    lojaNome: r.loja_nome,
    promotionId: r.promotion_id,
    nome: r.nome,
    percentualDesconto: Number(r.percentual_desconto),
    dataInicio: r.data_inicio,
    dataFim: r.data_fim,
    status: r.status,
    campanhaAnteriorId: r.campanha_anterior_id,
    itens: itensPorCampanha.get(r.id) ?? [],
  }));
}

// Job periódico (mesmo padrão de iniciarSnapshotAds em adsService.ts):
// mantém o status de cada campanha ainda não "finished" atualizado, sem
// depender de uma consulta ao vivo toda vez que a tela carrega.
export async function sincronizarStatusCampanhas(): Promise<void> {
  const { rows } = await pool.query<{ id: number; loja_id: number; promotion_id: string }>(
    "SELECT id, loja_id, promotion_id FROM promocoes_campanhas WHERE status != 'finished'"
  );
  for (const r of rows) {
    try {
      const status = await obterStatusCampanha(r.loja_id, r.promotion_id);
      await pool.query("UPDATE promocoes_campanhas SET status = $2, atualizado_em = now() WHERE id = $1", [
        r.id,
        status,
      ]);
    } catch (err) {
      console.error(`Erro ao sincronizar status da campanha ${r.id}:`, err);
    }
  }
}

export function iniciarSincronizacaoPromocoes(): void {
  sincronizarStatusCampanhas().catch((err) => console.error("Erro na sincronização inicial de promoções:", err));
  setInterval(
    () => {
      sincronizarStatusCampanhas().catch((err) => console.error("Erro na sincronização de promoções:", err));
    },
    4 * 60 * 60 * 1000
  );
}
