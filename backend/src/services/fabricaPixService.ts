import ExcelJS from "exceljs";
import { pool } from "../db/pool";

// Conciliação do PIX recebido.
//
// O extrato de conta corrente do Sicoob não serve pra isto: ele empacota os
// PIX de outras instituições numa linha por dia e por tipo, com o documento
// "AGRUPADO" e o pagador perdido. Em julho e agosto de 2026 foram 41 linhas
// escondendo 152 PIX — 83% do dinheiro entrando sem nome. Testamos os cinco
// formatos que o Sicoob exporta (OFX, XLS, Bancoob 500, CNAB 240, texto): o
// agrupamento é do lançamento, não do formato, e vem igual em todos.
//
// O relatório de Movimentação - Recebimento Pix é outro arquivo, e traz uma
// linha por transação com o pagador. É ele que se importa aqui.
//
// O relatório não traz CNPJ. A ligação com a loja é pelo nome, e nome varia:
// "MODALTINTAS LTDA" e "Modaltintas Ltda" são a mesma empresa, e a mesma loja
// ainda paga por CNPJ diferente conforme o canal — a Modal manda pela
// MODALTINTAS e pela GOMES E TAVARES, a Truck por duas empresas, a Fábrica
// Loja pelo Mercado Pago e pela Shopee. Por isso a origem é uma tabela: se
// aponta uma vez, fica gravado, e no mês seguinte entra sozinho.

export type DestinoPix = "CLIENTE" | "APORTE" | "AVULSA" | "IGNORAR";

export interface LinhaPix {
  e2e: string;
  data: string;
  pagador: string;
  instituicao: string;
  descricao: string;
  valor: number;
}

export interface OrigemPix {
  id: number;
  chave: string;
  nome: string;
  clienteId: number | null;
  clienteNome: string | null;
  destino: DestinoPix;
  // quanto já entrou por esta origem, pra dar contexto na hora de decidir
  recebido: number;
  transacoes: number;
}

export interface PendentePix {
  pagador: string;
  instituicao: string;
  transacoes: number;
  valor: number;
  primeira: string;
  ultima: string;
}

export interface ConferenciaPix {
  linhasNoArquivo: number;
  // linha do relatório que não é transação: cabeçalho, rodapé, linha em branco
  ignoradas: number;
  periodo: { de: string; ate: string } | null;
  total: number;
  // já importado numa rodada anterior: o EndToEndId bate, não entra de novo
  jaImportados: { transacoes: number; valor: number };
  // pagamento que já estava lançado na mão e casa com este PIX em loja, dia e
  // valor. Não vira pagamento novo — o PIX se amarra no que já existe.
  adotaveis: { transacoes: number; valor: number };
  novos: Array<{ clienteId: number; clienteNome: string; transacoes: number; valor: number }>;
  semDivida: Array<{ destino: DestinoPix; transacoes: number; valor: number }>;
  pendentes: PendentePix[];
}

export interface ResultadoPix {
  pagamentosCriados: number;
  pagamentosAdotados: number;
  valorLancado: number;
  registrados: number;
  jaImportados: number;
  pendentes: number;
}

// Nome do pagador vira chave: sem acento, sem pontuação, sem espaço dobrado.
// "Modaltintas Ltda" e "MODALTINTAS LTDA" caem no mesmo lugar; empresas com
// nomes parecidos continuam separadas, porque nenhum pedaço é descartado.
export function chaveOrigem(nome: string): string {
  return String(nome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function texto(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: Array<{ text: string }> };
    if (typeof o.text === "string") return o.text;
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("");
    if (o.result !== undefined) return texto(o.result);
  }
  return String(v);
}

// "R$ 80.000,00" — com espaço não separável no meio, que é como o Sicoob
// escreve. Quando o Excel guardou como número, vem número e pronto.
function numero(v: unknown): number {
  if (typeof v === "number") return v;
  const t = texto(v)
    .replace(/ /g, " ")
    .replace(/[R$\s]/g, "")
    .trim();
  if (!t) return 0;
  if (/,\d{1,2}$/.test(t)) return Number(t.replace(/\./g, "").replace(",", ".")) || 0;
  return Number(t.replace(/,/g, "")) || 0;
}

function dataIso(v: unknown): string | null {
  if (v instanceof Date) {
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${v.getFullYear()}-${m}-${d}`;
  }
  const t = texto(v).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

// Lê o .xlsx do Sicoob. O cabeçalho não fica na linha 1 — antes vêm o nome do
// banco, a cooperativa, a conta e o período —, então se procura a linha que
// começa com "Data/Hora Movimento" em vez de assumir posição fixa.
export async function lerRelatorioPix(
  buffer: Buffer
): Promise<{ linhas: LinhaPix[]; total: number; ignoradas: number }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("A planilha veio vazia.");

  let cab = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 60); r++) {
    if (chaveOrigem(texto(ws.getRow(r).getCell(1).value)).startsWith("DATA HORA MOVIMENTO")) {
      cab = r;
      break;
    }
  }
  if (!cab) {
    throw new Error(
      "Não achei o cabeçalho do extrato Pix. Exporte em Pix, Extrato Pix, Recebidos, formato .xlsx."
    );
  }

  const limpa = (v: unknown): string => {
    const t = texto(v).replace(/\s+/g, " ").trim();
    return t === "-" ? "" : t;
  };

  const linhas: LinhaPix[] = [];
  let ignoradas = 0;
  let total = 0;
  for (let r = cab + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const data = dataIso(row.getCell(1).value);
    const e2e = texto(row.getCell(2).value).trim();
    const valor = numero(row.getCell(8).value);
    if (!data || !e2e || valor <= 0) {
      ignoradas++;
      continue;
    }
    total++;
    linhas.push({
      e2e,
      data,
      pagador: limpa(row.getCell(4).value),
      instituicao: limpa(row.getCell(5).value),
      descricao: limpa(row.getCell(6).value),
      valor,
    });
  }
  // o mesmo EndToEndId não se repete num relatório, mas se dois meses forem
  // colados num arquivo só, uma leitura só de cada
  const porE2e = new Map(linhas.map((l) => [l.e2e, l]));
  return { linhas: [...porE2e.values()], total, ignoradas };
}

export async function listarOrigens(): Promise<OrigemPix[]> {
  const { rows } = await pool.query<{
    id: number;
    chave: string;
    nome: string;
    cliente_id: number | null;
    cliente_nome: string | null;
    destino: DestinoPix;
    recebido: string | null;
    transacoes: string;
  }>(
    `SELECT o.id, o.chave, o.nome, o.cliente_id, c.nome AS cliente_nome, o.destino,
            COALESCE(SUM(p.valor), 0) AS recebido, COUNT(p.e2e) AS transacoes
       FROM fabrica_pix_origem o
       LEFT JOIN fabrica_clientes c ON c.id = o.cliente_id
       LEFT JOIN fabrica_pix_recebido p ON p.pagador = o.nome
      GROUP BY o.id, c.nome
      ORDER BY COALESCE(SUM(p.valor), 0) DESC, o.nome`
  );
  return rows.map((r) => ({
    id: r.id,
    chave: r.chave,
    nome: r.nome,
    clienteId: r.cliente_id,
    clienteNome: r.cliente_nome,
    destino: r.destino,
    recebido: Number(r.recebido),
    transacoes: Number(r.transacoes),
  }));
}

export async function salvarOrigem(
  nome: string,
  clienteId: number | null,
  destino: DestinoPix
): Promise<void> {
  const chave = chaveOrigem(nome);
  if (!chave) throw new Error("Origem sem nome.");
  if (destino === "CLIENTE" && !clienteId) {
    throw new Error("Escolha a loja para uma origem que abate dívida.");
  }
  await pool.query(
    `INSERT INTO fabrica_pix_origem (chave, nome, cliente_id, destino)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (chave) DO UPDATE
       SET nome = EXCLUDED.nome,
           cliente_id = EXCLUDED.cliente_id,
           destino = EXCLUDED.destino`,
    [chave, nome.trim(), destino === "CLIENTE" ? clienteId : null, destino]
  );
}

export async function excluirOrigem(id: number): Promise<void> {
  await pool.query("DELETE FROM fabrica_pix_origem WHERE id = $1", [id]);
}

interface Resolvida extends LinhaPix {
  clienteId: number | null;
  clienteNome: string | null;
  destino: DestinoPix | null;
  jaImportado: boolean;
  // pagamento lançado na mão que casa com este PIX: mesma loja, mesmo dia,
  // mesmo valor. Existe porque a Modal foi conciliada a mão antes disto.
  adotaId: number | null;
}

async function resolver(linhas: LinhaPix[]): Promise<Resolvida[]> {
  const { rows: origens } = await pool.query<{
    chave: string;
    cliente_id: number | null;
    cliente_nome: string | null;
    destino: DestinoPix;
  }>(
    `SELECT o.chave, o.cliente_id, c.nome AS cliente_nome, o.destino
       FROM fabrica_pix_origem o
       LEFT JOIN fabrica_clientes c ON c.id = o.cliente_id`
  );
  const porChave = new Map(origens.map((o) => [o.chave, o]));

  const { rows: vistos } = await pool.query<{ e2e: string; pagamento_id: number | null }>(
    "SELECT e2e, pagamento_id FROM fabrica_pix_recebido WHERE e2e = ANY($1::text[])",
    [linhas.map((l) => l.e2e)]
  );
  // pagamento_id nulo com destino CLIENTE quer dizer que alguém apagou o
  // pagamento na tela: o PIX volta a valer como pendente em vez de sumir
  const importados = new Set(
    vistos.filter((v) => v.pagamento_id !== null).map((v) => v.e2e)
  );

  // pagamentos já lançados que ainda não têm PIX amarrado — candidatos a adoção
  const { rows: soltos } = await pool.query<{
    id: number;
    cliente_id: number;
    data: string;
    valor: string;
  }>(
    `SELECT p.id, p.cliente_id, p.data::text AS data, p.valor
       FROM fabrica_pagamentos p
      WHERE NOT EXISTS (
        SELECT 1 FROM fabrica_pix_recebido x WHERE x.pagamento_id = p.id
      )`
  );
  const livres = new Map<string, number[]>();
  for (const p of soltos) {
    const k = `${p.cliente_id}|${p.data}|${Number(p.valor).toFixed(2)}`;
    livres.set(k, [...(livres.get(k) ?? []), p.id]);
  }

  return linhas.map((l) => {
    const o = porChave.get(chaveOrigem(l.pagador));
    const clienteId = o?.destino === "CLIENTE" ? o.cliente_id : null;
    let adotaId: number | null = null;
    if (clienteId && !importados.has(l.e2e)) {
      const k = `${clienteId}|${l.data}|${l.valor.toFixed(2)}`;
      const fila = livres.get(k);
      if (fila && fila.length) adotaId = fila.shift() ?? null;
    }
    return {
      ...l,
      clienteId,
      clienteNome: o?.cliente_nome ?? null,
      destino: o?.destino ?? null,
      jaImportado: importados.has(l.e2e),
      adotaId,
    };
  });
}

export async function conferirPix(linhas: LinhaPix[], lidas: number, ignoradas: number): Promise<ConferenciaPix> {
  const res = await resolver(linhas);
  const datas = linhas.map((l) => l.data).sort();

  const novos = new Map<number, { clienteNome: string; transacoes: number; valor: number }>();
  const semDivida = new Map<DestinoPix, { transacoes: number; valor: number }>();
  const pendentes = new Map<string, PendentePix>();
  let jaT = 0;
  let jaV = 0;
  let adT = 0;
  let adV = 0;

  for (const r of res) {
    if (r.jaImportado) {
      jaT++;
      jaV += r.valor;
      continue;
    }
    if (!r.destino) {
      const k = chaveOrigem(r.pagador);
      const p = pendentes.get(k) ?? {
        pagador: r.pagador,
        instituicao: r.instituicao,
        transacoes: 0,
        valor: 0,
        primeira: r.data,
        ultima: r.data,
      };
      p.transacoes++;
      p.valor += r.valor;
      if (r.data < p.primeira) p.primeira = r.data;
      if (r.data > p.ultima) p.ultima = r.data;
      pendentes.set(k, p);
      continue;
    }
    if (r.destino !== "CLIENTE" || !r.clienteId) {
      const s = semDivida.get(r.destino) ?? { transacoes: 0, valor: 0 };
      s.transacoes++;
      s.valor += r.valor;
      semDivida.set(r.destino, s);
      continue;
    }
    if (r.adotaId) {
      adT++;
      adV += r.valor;
    }
    const n = novos.get(r.clienteId) ?? {
      clienteNome: r.clienteNome ?? `#${r.clienteId}`,
      transacoes: 0,
      valor: 0,
    };
    n.transacoes++;
    n.valor += r.valor;
    novos.set(r.clienteId, n);
  }

  return {
    linhasNoArquivo: lidas,
    ignoradas,
    periodo: datas.length ? { de: datas[0], ate: datas[datas.length - 1] } : null,
    total: linhas.reduce((s, l) => s + l.valor, 0),
    jaImportados: { transacoes: jaT, valor: jaV },
    adotaveis: { transacoes: adT, valor: adV },
    novos: [...novos.entries()]
      .map(([clienteId, n]) => ({ clienteId, ...n }))
      .sort((a, b) => b.valor - a.valor),
    semDivida: [...semDivida.entries()].map(([destino, s]) => ({ destino, ...s })),
    pendentes: [...pendentes.values()].sort((a, b) => b.valor - a.valor),
  };
}

// Lança de verdade. Uma transação só pro banco: 178 PIX importados pela metade
// deixariam a conta corrente de todo mundo errada, e descobrir qual metade
// entrou seria pior do que refazer.
//
// Não gera a bonificação de 3,5% aqui, de propósito. Este importador serve
// pra trazer o que já aconteceu — julho e agosto —, e a bonificação é regra
// que vale daqui pra frente. Gerar retroativo criaria crédito que ninguém
// combinou. Pagamento novo, lançado na tela, continua bonificando normal.
export async function importarPix(linhas: LinhaPix[]): Promise<ResultadoPix> {
  const res = await resolver(linhas);
  const cliente = await pool.connect();
  let criados = 0;
  let adotados = 0;
  let valorLancado = 0;
  let registrados = 0;
  let jaImportados = 0;
  let pendentes = 0;

  try {
    await cliente.query("BEGIN");
    for (const r of res) {
      if (r.jaImportado) {
        jaImportados++;
        continue;
      }
      if (!r.destino) {
        pendentes++;
        continue;
      }

      let pagamentoId: number | null = null;
      if (r.destino === "CLIENTE" && r.clienteId) {
        if (r.adotaId) {
          pagamentoId = r.adotaId;
          adotados++;
        } else {
          const obs = [
            "PIX",
            r.instituicao || null,
            r.descricao || null,
            "conciliado pelo extrato Pix",
          ]
            .filter(Boolean)
            .join(" · ");
          const { rows } = await cliente.query<{ id: number }>(
            `INSERT INTO fabrica_pagamentos (cliente_id, data, valor, observacao)
             VALUES ($1, $2::date, $3, $4) RETURNING id`,
            [r.clienteId, r.data, r.valor, obs]
          );
          pagamentoId = Number(rows[0].id);
          criados++;
        }
        valorLancado += r.valor;
      }

      await cliente.query(
        `INSERT INTO fabrica_pix_recebido
           (e2e, data, pagador, instituicao, descricao, valor, cliente_id, destino, pagamento_id)
         VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (e2e) DO UPDATE
           SET cliente_id = EXCLUDED.cliente_id,
               destino = EXCLUDED.destino,
               pagamento_id = EXCLUDED.pagamento_id`,
        [
          r.e2e,
          r.data,
          r.pagador,
          r.instituicao || null,
          r.descricao || null,
          r.valor,
          r.clienteId,
          r.destino,
          pagamentoId,
        ]
      );
      registrados++;
    }
    await cliente.query("COMMIT");
  } catch (err) {
    await cliente.query("ROLLBACK");
    throw err;
  } finally {
    cliente.release();
  }

  return {
    pagamentosCriados: criados,
    pagamentosAdotados: adotados,
    valorLancado,
    registrados,
    jaImportados,
    pendentes,
  };
}
