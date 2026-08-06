import axios from "axios";
import { pool } from "../db/pool";
import { listLojas } from "./tokenStore";
import {
  criarCampanhaVendedor,
  adicionarItemCampanha,
  obterDetalhesCampanha,
  getItemsBasicInfo,
  listarItensAtivos,
  consultarPromocoesDoItem,
  obterItensDaCampanha,
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

export interface ItemComPercentual {
  itemId: string;
  percentual: number;
}

// Cria a campanha no Mercado Livre e adiciona cada item, um por um — um
// item pode falhar por não ser elegível (reputação, condição, exposição
// paga) sem travar os outros; o resultado devolve sucesso/erro por item
// pra tela mostrar exatamente o que colou. Só grava no banco os itens que
// entraram de fato — a campanha em si é gravada mesmo com falhas parciais,
// já que ela existe de verdade no Mercado Livre a partir da criação.
//
// Percentual é POR ITEM, não um único pra todos — importante pra recriar
// (ver recriarCampanha) uma campanha descoberta automaticamente, onde cada
// anúncio pode ter tido um % de desconto diferente no Mercado Livre; achatar
// tudo num percentual médio mudaria o preço real de itens que tinham um
// desconto bem diferente da média (ticket alto com % baixo vs ticket baixo
// com % alto, por exemplo).
export async function criarCampanha(
  lojaId: number,
  nome: string,
  itens: ItemComPercentual[],
  campanhaAnteriorId: number | null = null
): Promise<ResultadoCriarCampanha> {
  if (itens.length === 0) {
    throw new Error("Informe ao menos um item.");
  }

  const hoje = new Date();
  const fim = new Date(hoje.getTime() + DIAS_CAMPANHA * 24 * 60 * 60 * 1000);
  const dataInicio = dataISO(hoje);
  const dataFim = dataISO(fim);

  let campanhaMl;
  try {
    campanhaMl = await criarCampanhaVendedor(lojaId, nome, dataInicio, dataFim);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const mensagemMl = (err.response?.data as { message?: string })?.message;
      // 403 aqui costuma ser a mesma pegadinha de permissão já documentada em
      // getPromocaoStatus (mercadoLivreApi.ts): "Preços e promoções" precisa
      // estar habilitada no app E a conta reautorizada depois disso — mudar
      // a permissão não atualiza tokens já emitidos.
      if (status === 403) {
        throw new Error(
          `Mercado Livre recusou (403${mensagemMl ? `: ${mensagemMl}` : ""}) — provavelmente a permissão "Preços e promoções" não está habilitada/reautorizada pra essa loja no app do Mercado Livre.`
        );
      }
      throw new Error(
        `Falha ao criar campanha no Mercado Livre (HTTP ${status}${mensagemMl ? `: ${mensagemMl}` : ""}) — nome enviado: "${nome}" (${nome.length} caracteres).`
      );
    }
    throw err;
  }

  const precos = await getItemsBasicInfo(
    lojaId,
    itens.map((i) => i.itemId)
  );
  const itensResultado: ResultadoItemCampanha[] = [];

  for (const { itemId, percentual } of itens) {
    const info = precos.get(itemId);
    if (!info) {
      itensResultado.push({ itemId, ok: false, erro: "Anúncio não encontrado." });
      continue;
    }
    // Item fora da faixa aceita pelo ML (10-70%) não trava o lote inteiro —
    // fica de fora só ele, com o motivo explicado.
    if (percentual < PERCENTUAL_MINIMO || percentual > PERCENTUAL_MAXIMO) {
      itensResultado.push({
        itemId,
        ok: false,
        erro: `Percentual (${percentual.toFixed(1)}%) fora da faixa aceita pelo ML (${PERCENTUAL_MINIMO}-${PERCENTUAL_MAXIMO}%).`,
      });
      continue;
    }
    const dealPrice = arredondarCentavos(info.price * (1 - percentual / 100));
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

  // percentual_desconto da campanha é só um valor representativo pra
  // exibição na lista (média do que foi aplicado de fato) — o preço real de
  // cada item usa o percentual individual dele, guardado em promocoes_itens.
  const percentualMedio =
    itens.length > 0 ? itens.reduce((s, i) => s + i.percentual, 0) / itens.length : 0;

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO promocoes_campanhas
       (loja_id, promotion_id, nome, percentual_desconto, data_inicio, data_fim, status, campanha_anterior_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [lojaId, campanhaMl.id, nome, percentualMedio, dataInicio, dataFim, campanhaMl.status, campanhaAnteriorId]
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

export interface RegistroExistente {
  lojaId: number;
  nome: string;
  percentualDesconto: number;
  itemIds: string[];
  dataFim: string; // YYYY-MM-DD
  promotionId?: string;
}

// Registra uma campanha que JÁ EXISTE no Mercado Livre (criada direto por
// lá, antes desse módulo existir) — não cria nada novo, não chama nenhum
// endpoint de escrita do ML. Só lê o preço atual de cada item (leitura,
// sem risco) pra guardar um registro consistente, e grava no banco como
// se já estivesse rodando (status "started"). A partir daqui ela passa a
// aparecer na lista e pode ser recriada normalmente quando vencer.
export async function registrarCampanhaExistente(reg: RegistroExistente): Promise<ResultadoCriarCampanha> {
  if (reg.percentualDesconto < PERCENTUAL_MINIMO || reg.percentualDesconto > PERCENTUAL_MAXIMO) {
    throw new Error(`Percentual precisa ficar entre ${PERCENTUAL_MINIMO}% e ${PERCENTUAL_MAXIMO}%.`);
  }
  if (reg.itemIds.length === 0) {
    throw new Error("Informe ao menos um item.");
  }

  const promotionId = reg.promotionId?.trim() || `EXTERNA-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const precos = await getItemsBasicInfo(reg.lojaId, reg.itemIds);
  const itensResultado: ResultadoItemCampanha[] = [];

  for (const itemId of reg.itemIds) {
    const info = precos.get(itemId);
    if (!info) {
      itensResultado.push({ itemId, ok: false, erro: "Anúncio não encontrado." });
      continue;
    }
    const dealPrice = arredondarCentavos(info.price * (1 - reg.percentualDesconto / 100));
    itensResultado.push({ itemId, ok: true, precoOriginal: info.price, dealPrice });
  }

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO promocoes_campanhas
       (loja_id, promotion_id, nome, percentual_desconto, data_inicio, data_fim, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'started')
     RETURNING id`,
    [reg.lojaId, promotionId, reg.nome, reg.percentualDesconto, dataISO(new Date()), reg.dataFim]
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

  return { campanhaId, promotionId, nome: reg.nome, itens: itensResultado };
}

// Lê a campanha antiga do banco e recria com o mesmo nome (+ sufixo de
// data, pra não bater no erro "name already exists" do Mercado Livre),
// mesmos itens — preço recalculado do zero em cima do preço ATUAL de cada
// item, não repete o preço antigo (pode estar desatualizado se o produto
// mudou de preço nesse meio tempo).
//
// O percentual usado é o de CADA ITEM individualmente (calculado a partir
// do preco_original/deal_price que ficou salvo dele), não a média da
// campanha — campanhas descobertas automaticamente no Mercado Livre podem
// ter % bem diferente por item (ticket alto com % baixo, ticket baixo com
// % alto), e achatar tudo numa média mudaria o desconto real de cada um.
export async function recriarCampanha(campanhaAntigaId: number): Promise<ResultadoCriarCampanha> {
  const { rows } = await pool.query<{
    loja_id: number;
    nome: string;
  }>("SELECT loja_id, nome FROM promocoes_campanhas WHERE id = $1", [campanhaAntigaId]);
  if (rows.length === 0) throw new Error("Campanha não encontrada.");

  const { rows: itensRows } = await pool.query<{
    item_id: string;
    preco_original: string;
    deal_price: string;
  }>("SELECT item_id, preco_original, deal_price FROM promocoes_itens WHERE campanha_id = $1", [campanhaAntigaId]);
  if (itensRows.length === 0) throw new Error("Essa campanha não tem itens registrados pra recriar.");

  const itens: ItemComPercentual[] = itensRows.map((r) => {
    const precoOriginal = Number(r.preco_original);
    const dealPrice = Number(r.deal_price);
    const percentual = precoOriginal > 0 ? (1 - dealPrice / precoOriginal) * 100 : 0;
    return { itemId: r.item_id, percentual };
  });

  // "/" no sufixo já causou "Invalid name" (HTTP 400) numa campanha real -
  // ML parece não aceitar barra no nome da promoção. Usa "-" em vez de "/".
  const sufixo = ` (${dataISO(new Date()).split("-").reverse().slice(0, 2).join("-")})`;
  return criarCampanha(rows[0].loja_id, rows[0].nome + sufixo, itens, campanhaAntigaId);
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

// Apaga só o rastreamento no painel (promocoes_itens some junto via ON
// DELETE CASCADE) — não mexe em nada real no Mercado Livre. Útil pra
// limpar registros incompletos de testes/bugs já corrigidos antes de
// rodar a descoberta de novo.
export async function excluirCampanha(id: number, lojaIdFiltro?: number, lojasPermitidas?: number[]): Promise<void> {
  const lojas = (await listLojas()).filter(
    (l) => (lojaIdFiltro === undefined || l.id === lojaIdFiltro) && (lojasPermitidas === undefined || lojasPermitidas.includes(l.id))
  );
  const lojaIds = lojas.map((l) => l.id);
  // campanha_anterior_id é auto-referenciada (corrente de renovações) — se
  // uma campanha mais nova aponta pra essa, apagar direto bate na foreign
  // key. Desfaz essa referência antes (a campanha nova só perde o "elo com
  // a anterior", continua existindo normalmente).
  await pool.query("UPDATE promocoes_campanhas SET campanha_anterior_id = NULL WHERE campanha_anterior_id = $1", [id]);
  const { rowCount } = await pool.query("DELETE FROM promocoes_campanhas WHERE id = $1 AND loja_id = ANY($2)", [id, lojaIds]);
  if (rowCount === 0) {
    throw new Error("Campanha não encontrada ou sem acesso.");
  }
}

// Limpa todo o rastreamento (respeitando o filtro de loja de quem pediu) —
// mesma observação: só apaga registros do painel, não toca no Mercado Livre.
export async function limparCampanhas(lojaIdFiltro?: number, lojasPermitidas?: number[]): Promise<number> {
  const lojas = (await listLojas()).filter(
    (l) => (lojaIdFiltro === undefined || l.id === lojaIdFiltro) && (lojasPermitidas === undefined || lojasPermitidas.includes(l.id))
  );
  const lojaIds = lojas.map((l) => l.id);
  if (lojaIds.length === 0) return 0;
  // Mesmo motivo do excluirCampanha: desfaz referências de campanha_anterior_id
  // que apontam pra qualquer linha dentro do escopo sendo apagado (inclui
  // campanhas de FORA do escopo que apontem pra uma de dentro, senão a
  // foreign key bloqueia o delete de qualquer jeito).
  await pool.query(
    "UPDATE promocoes_campanhas SET campanha_anterior_id = NULL WHERE campanha_anterior_id IN (SELECT id FROM promocoes_campanhas WHERE loja_id = ANY($1))",
    [lojaIds]
  );
  const { rowCount } = await pool.query("DELETE FROM promocoes_campanhas WHERE loja_id = ANY($1)", [lojaIds]);
  return rowCount ?? 0;
}

// Job periódico (mesmo padrão de iniciarSnapshotAds em adsService.ts):
// mantém o status de cada campanha ainda não "finished" atualizado, sem
// depender de uma consulta ao vivo toda vez que a tela carrega.
export async function sincronizarStatusCampanhas(): Promise<void> {
  // Campanhas registradas manualmente sem ID real (ver registrarCampanhaExistente)
  // ganham um promotion_id placeholder "EXTERNA-..." — não existe no Mercado
  // Livre, consultar isso só geraria erro toda vez sem necessidade.
  const { rows } = await pool.query<{ id: number; loja_id: number; promotion_id: string }>(
    "SELECT id, loja_id, promotion_id FROM promocoes_campanhas WHERE status != 'finished' AND promotion_id NOT LIKE 'EXTERNA-%'"
  );
  for (const r of rows) {
    try {
      const detalhes = await obterDetalhesCampanha(r.loja_id, r.promotion_id);
      await pool.query("UPDATE promocoes_campanhas SET status = $2, atualizado_em = now() WHERE id = $1", [
        r.id,
        detalhes.status,
      ]);
    } catch (err) {
      console.error(`Erro ao sincronizar status da campanha ${r.id}:`, err);
    }
  }
}

async function comConcorrenciaLimitada<T, R>(itens: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(itens.length);
  let indice = 0;
  async function worker() {
    while (indice < itens.length) {
      const i = indice++;
      resultados[i] = await fn(itens[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, worker));
  return resultados;
}

export interface ProgressoDescoberta {
  emAndamento: boolean;
  lojaAtual: string | null;
  itensVerificados: number;
  totalItens: number;
  campanhasEncontradas: number;
  campanhasCompletadas: number;
  itensComErro: number;
  candidatosDescartados: number;
  amostraErro: string | null;
  erro: string | null;
}

let progressoDescoberta: ProgressoDescoberta = {
  emAndamento: false,
  lojaAtual: null,
  itensVerificados: 0,
  totalItens: 0,
  campanhasEncontradas: 0,
  campanhasCompletadas: 0,
  itensComErro: 0,
  candidatosDescartados: 0,
  amostraErro: null,
  erro: null,
};

export function obterProgressoDescoberta(): ProgressoDescoberta {
  return progressoDescoberta;
}

// Concorrência bem baixa (2) e sequencial entre lojas (não roda várias
// lojas ao mesmo tempo) — de propósito mais conservador que o resto do
// sistema, porque aqui o volume é "todo anúncio ativo de cada loja", que
// pode ser bem maior do que qualquer outra busca já feita no painel. Já
// tomamos um 429 (rate limit) com um volume bem menor no DRE antes.
const CONCORRENCIA_DESCOBERTA = 2;

async function descobrirCampanhasNaLoja(lojaId: number, lojaNome: string, mlUserId: number): Promise<void> {
  progressoDescoberta.lojaAtual = lojaNome;
  const itemIds = await listarItensAtivos(lojaId, mlUserId);
  progressoDescoberta.totalItens += itemIds.length;

  const promotionIdsEncontrados = new Set<string>();
  await comConcorrenciaLimitada(itemIds, CONCORRENCIA_DESCOBERTA, async (itemId) => {
    try {
      const promocoes = await consultarPromocoesDoItem(lojaId, itemId);
      for (const p of promocoes) {
        // Não filtramos por p.type aqui: o valor exato que o ML devolve pra
        // SELLER_CAMPAIGN não foi confirmado contra uma resposta real (só
        // documentação), e getPromocaoStatus (já em produção há tempos, ver
        // mercadoLivreApi.ts) confia só em status === "started" pra esse
        // mesmo endpoint. Falsos positivos (outro tipo de promoção) não
        // registram: obterDetalhesCampanha pede promotion_type=SELLER_CAMPAIGN
        // e falha/pula silenciosamente (catch abaixo) se não bater.
        if (p.status === "started" && p.promotionId) {
          promotionIdsEncontrados.add(p.promotionId);
        }
      }
    } catch (err) {
      // item pontual falhou — segue o scan, não trava por causa de um
      // anúncio, mas guardamos uma amostra do erro (ex.: 403
      // PA_UNAUTHORIZED_RESULT_FROM_POLICIES — permissão "Preços e
      // promoções" não habilitada/reautorizada nessa loja, ver
      // getPromocaoStatus em mercadoLivreApi.ts) senão "0 encontradas"
      // fica indistinguível de "deu erro em tudo silenciosamente".
      progressoDescoberta.itensComErro++;
      if (axios.isAxiosError(err)) {
        progressoDescoberta.amostraErro = `HTTP ${err.response?.status}: ${
          (err.response?.data as { message?: string })?.message ?? err.message
        }`;
      } else {
        progressoDescoberta.amostraErro = err instanceof Error ? err.message : "Erro desconhecido";
      }
    } finally {
      progressoDescoberta.itensVerificados++;
    }
  });

  for (const promotionId of promotionIdsEncontrados) {
    const jaRastreada = await pool.query<{ id: number; qtd_itens: string }>(
      `SELECT c.id, COUNT(i.id) AS qtd_itens
       FROM promocoes_campanhas c LEFT JOIN promocoes_itens i ON i.campanha_id = c.id
       WHERE c.promotion_id = $1 GROUP BY c.id`,
      [promotionId]
    );
    // Já rastreada E já tem itens: nada a fazer. Já rastreada mas com 0
    // itens: não pula — tenta completar de novo (pode ter sido um erro de
    // leitura antigo, ver diagnóstico abaixo), sem duplicar a campanha.
    const campanhaExistenteId = jaRastreada.rows.length > 0 ? jaRastreada.rows[0].id : null;
    if (campanhaExistenteId !== null && Number(jaRastreada.rows[0].qtd_itens) > 0) continue;

    try {
      const [detalhes, resultadoItens] = await Promise.all([
        obterDetalhesCampanha(lojaId, promotionId),
        obterItensDaCampanha(lojaId, promotionId),
      ]);
      const itensCampanha = resultadoItens.itens;

      // Diagnóstico temporário: mostra sempre a contagem por status (ex.:
      // started/candidate) e quantas páginas foram lidas — visto que o
      // painel do ML mostra "muito mais" itens do que só os status
      // (achado numa depuração ao vivo, precisa de dado real pra decidir
      // se "started" é mesmo o único status que conta). Some com esse
      // bloco assim que resolvido.
      progressoDescoberta.amostraErro = `[diagnóstico ${promotionId} / ${detalhes.name}] paginas=${resultadoItens.paginasLidas} status=${JSON.stringify(resultadoItens.contagemPorStatus)} usados(started)=${itensCampanha.length}`;

      if (itensCampanha.length === 0 && campanhaExistenteId !== null) {
        continue; // já registrada, só faltavam os itens — sem novidade, segue
      }

      let campanhaId = campanhaExistenteId;
      if (campanhaId === null) {
        const { rows } = await pool.query<{ id: number }>(
          `INSERT INTO promocoes_campanhas (loja_id, promotion_id, nome, percentual_desconto, data_inicio, data_fim, status)
           VALUES ($1, $2, $3, $4, $5::text::date, $6::text::date, $7)
           RETURNING id`,
          [
            lojaId,
            promotionId,
            detalhes.name,
            // percentual médio dos itens da campanha (cada item pode ter %
            // levemente diferente, arredondado pelo preço) — guardamos um
            // valor representativo pra exibição, não afeta o recálculo na
            // hora de recriar (que usa o preço atual de novo).
            itensCampanha.length > 0
              ? itensCampanha.reduce((s, it) => s + (1 - it.price / it.originalPrice) * 100, 0) / itensCampanha.length
              : 0,
            detalhes.start_date.slice(0, 10),
            detalhes.finish_date.slice(0, 10),
            detalhes.status,
          ]
        );
        campanhaId = rows[0].id;
      }

      for (const it of itensCampanha) {
        await pool.query(
          `INSERT INTO promocoes_itens (campanha_id, item_id, titulo, preco_original, deal_price) VALUES ($1, $2, $3, $4, $5)`,
          [campanhaId, it.itemId, null, it.originalPrice, it.price]
        );
      }
      if (campanhaExistenteId === null) {
        progressoDescoberta.campanhasEncontradas++;
      } else if (itensCampanha.length > 0) {
        progressoDescoberta.campanhasCompletadas++;
      }
    } catch (err) {
      // Candidato tinha status "started" em consultarPromocoesDoItem, mas
      // obterDetalhesCampanha (que exige promotion_type=SELLER_CAMPAIGN)
      // rejeitou — normalmente porque é outro tipo de promoção do ML
      // (oferta do dia, preço mínimo garantido, etc.), não uma campanha do
      // vendedor. Contamos em vez de só logar no servidor, pra dar pra ver
      // pela tela se é isso que está zerando a descoberta.
      progressoDescoberta.candidatosDescartados++;
      if (axios.isAxiosError(err)) {
        progressoDescoberta.amostraErro = `Descartado ${promotionId} — HTTP ${err.response?.status}: ${
          (err.response?.data as { message?: string })?.message ?? err.message
        }`;
      } else {
        progressoDescoberta.amostraErro = `Descartado ${promotionId} — ${err instanceof Error ? err.message : "erro desconhecido"}`;
      }
      console.error(`Erro ao registrar campanha descoberta ${promotionId}:`, err);
    }
  }
}

// Varre todo anúncio ativo de cada loja perguntando "você está em alguma
// campanha?" — não tem outro jeito de descobrir campanhas que já existem
// no Mercado Livre (criadas antes desse módulo, direto por lá), porque
// não existe endpoint de "listar minhas campanhas". Roda uma loja de cada
// vez (não em paralelo entre lojas) com concorrência baixa dentro de cada
// uma — ver CONCORRENCIA_DESCOBERTA.
export async function iniciarDescobertaCampanhas(lojaIdFiltro?: number, lojasPermitidas?: number[]): Promise<void> {
  if (progressoDescoberta.emAndamento) {
    throw new Error("Já tem uma descoberta em andamento.");
  }
  progressoDescoberta = {
    emAndamento: true,
    lojaAtual: null,
    itensVerificados: 0,
    totalItens: 0,
    campanhasEncontradas: 0,
    campanhasCompletadas: 0,
    itensComErro: 0,
    candidatosDescartados: 0,
    amostraErro: null,
    erro: null,
  };

  const lojas = (await listLojas()).filter(
    (l) =>
      l.ml_user_id !== null &&
      (lojaIdFiltro === undefined || l.id === lojaIdFiltro) &&
      (lojasPermitidas === undefined || lojasPermitidas.includes(l.id))
  );

  (async () => {
    try {
      for (const loja of lojas) {
        await descobrirCampanhasNaLoja(loja.id, loja.nome, loja.ml_user_id as number);
      }
    } catch (err) {
      progressoDescoberta.erro = err instanceof Error ? err.message : "Falha na descoberta.";
    } finally {
      progressoDescoberta.emAndamento = false;
      progressoDescoberta.lojaAtual = null;
    }
  })();
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
