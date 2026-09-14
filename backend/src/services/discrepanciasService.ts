import { pool } from "../db/pool";
import { listLojas } from "./tokenStore";
import {
  extrairItemIdDaUrl,
  getItemFullComToken,
  resolverItemIdPorUserProduct,
  extrairSkuDoItem,
  type MlItemFull,
  type IdentificadorAnuncio,
} from "./mercadoLivreItems";
import { listarVendasFinanceiras, normalizarSku } from "./financeiroService";
import { listarProdutos } from "./produtosService";

// Mesmo padrão de "tentar o token de cada loja até achar a dona" já usado
// (duplicado, não exportado) em clonarAnuncioService.ts e
// agenteImagensAnuncioService.ts — reimplementado aqui pelo mesmo motivo dos
// dois: não arriscar mexer num módulo já testado só pra compartilhar uma
// função pequena. Como bônus, quem tem o token que funciona É a loja dona —
// não precisa de nenhuma outra lógica pra "achar a loja".
async function encontrarLojaDoAnuncio(identificador: IdentificadorAnuncio): Promise<{ lojaId: number; item: MlItemFull }> {
  const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null);

  for (const loja of lojas) {
    try {
      if (identificador.tipo === "user_product") {
        const itemId = await resolverItemIdPorUserProduct(loja.id, loja.ml_user_id as number, identificador.id);
        if (!itemId) continue;
        return { lojaId: loja.id, item: await getItemFullComToken(loja.id, itemId) };
      }
      return { lojaId: loja.id, item: await getItemFullComToken(loja.id, identificador.id) };
    } catch {
      // não é dessa loja, tenta a próxima
    }
  }

  throw new Error("Esse anúncio não pertence a nenhuma das nossas lojas — confira o link.");
}

export interface Discrepancia {
  id: number;
  usuarioId: number | null;
  usuarioNome: string | null;
  lojaId: number | null;
  lojaNome: string | null;
  link: string;
  mlb: string;
  sku: string | null;
  titulo: string | null;
  preco: number | null;
  criadoEm: string;
  resposta: string | null;
}

interface LinhaDiscrepancia {
  id: number;
  usuario_id: number | null;
  usuario_nome: string | null;
  loja_id: number | null;
  loja_nome: string | null;
  link: string;
  mlb: string;
  sku: string | null;
  titulo: string | null;
  preco: string | null;
  criado_em: string;
  resposta: string | null;
}

function linhaParaDiscrepancia(r: LinhaDiscrepancia): Discrepancia {
  return {
    id: r.id,
    usuarioId: r.usuario_id,
    usuarioNome: r.usuario_nome,
    lojaId: r.loja_id,
    lojaNome: r.loja_nome,
    link: r.link,
    mlb: r.mlb,
    sku: r.sku,
    titulo: r.titulo,
    preco: r.preco !== null ? Number(r.preco) : null,
    criadoEm: r.criado_em,
    resposta: r.resposta,
  };
}

const SELECT_BASE = `
  SELECT d.id, d.usuario_id, u.nome AS usuario_nome, d.loja_id, l.nome AS loja_nome,
         d.link, d.mlb, d.sku, d.titulo, d.preco, d.criado_em, d.resposta
  FROM discrepancias d
  LEFT JOIN usuarios u ON u.id = d.usuario_id
  LEFT JOIN lojas l ON l.id = d.loja_id
`;

export async function registrarDiscrepancia(usuarioId: number, link: string): Promise<Discrepancia> {
  const identificador = await extrairItemIdDaUrl(link);
  const { lojaId, item } = await encontrarLojaDoAnuncio(identificador);
  const sku = extrairSkuDoItem(item) ?? null;

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO discrepancias (usuario_id, loja_id, link, mlb, sku, titulo, preco)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [usuarioId, lojaId, link, item.id, sku, item.title, item.price]
  );

  const { rows: linhas } = await pool.query<LinhaDiscrepancia>(`${SELECT_BASE} WHERE d.id = $1`, [rows[0].id]);
  return linhaParaDiscrepancia(linhas[0]);
}

export async function listarDiscrepancias(): Promise<Discrepancia[]> {
  const { rows } = await pool.query<LinhaDiscrepancia>(`${SELECT_BASE} ORDER BY d.criado_em DESC`);
  return rows.map(linhaParaDiscrepancia);
}

export async function excluirDiscrepancia(id: number, usuarioId: number, ehAdmin: boolean): Promise<void> {
  const condicao = ehAdmin ? "id = $1" : "id = $1 AND usuario_id = $2";
  const params = ehAdmin ? [id] : [id, usuarioId];
  const { rowCount } = await pool.query(`DELETE FROM discrepancias WHERE ${condicao}`, params);
  if (rowCount === 0) {
    throw new Error("Discrepância não encontrada ou sem permissão pra excluir essa aqui.");
  }
}

// Sem restrição de dono — mesmo espírito aberto do resto do módulo. É a
// loja apontada quem deveria responder, mas não temos como checar "esse
// usuário representa essa loja" no sistema hoje.
export async function responderDiscrepancia(id: number, resposta: string): Promise<void> {
  const { rowCount } = await pool.query("UPDATE discrepancias SET resposta = $1 WHERE id = $2", [resposta, id]);
  if (rowCount === 0) {
    throw new Error("Discrepância não encontrada.");
  }
}

export interface VendaRecente {
  margemPercentual: number | null;
  dataVenda: string;
}

const DIAS_JANELA_MARGEM = 90;
const MAX_VENDAS_RECENTES = 3;

// Reaproveita listarVendasFinanceiras (financeiroService.ts) em vez de
// duplicar a fórmula de margem — mesma fonte usada no Feed de vendas,
// inclusive o cache de 15min por loja+janela (então várias discrepâncias da
// mesma loja reaproveitam a mesma busca depois da primeira). Não guarda
// nada no banco — é buscado ao vivo, igual o resto do Financeiro nunca
// guarda margem, sempre recalcula.
export async function buscarUltimasVendas(lojaId: number, mlb: string): Promise<VendaRecente[]> {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - DIAS_JANELA_MARGEM * 24 * 60 * 60 * 1000);
  const dataInicio = inicio.toISOString().slice(0, 10);
  const dataFim = hoje.toISOString().slice(0, 10);

  const { vendas } = await listarVendasFinanceiras(lojaId, undefined, dataInicio, dataFim);
  return vendas
    .filter((v) => v.itemId === mlb)
    .sort((a, b) => new Date(b.dataCriacao).getTime() - new Date(a.dataCriacao).getTime())
    .slice(0, MAX_VENDAS_RECENTES)
    .map((v) => ({ margemPercentual: v.margemPercentual, dataVenda: v.dataCriacao }));
}

export interface PrecoOficial {
  classico: number;
  premium: number;
  shopee: number;
}

// Preço "combinado" oficial vem da mesma planilha de produtos usada no
// Financeiro (custo) — mesmo SKU master, mesma normalização (acento/
// maiúsculas) já usada lá, pra bater com o SKU real do anúncio.
export async function buscarPrecoOficial(sku: string | null): Promise<PrecoOficial | null> {
  if (!sku) return null;
  const produtos = await listarProdutos();
  const produto = produtos.find((p) => normalizarSku(p.sku) === normalizarSku(sku));
  if (!produto) return null;
  return { classico: produto.precoClassico, premium: produto.precoPremium, shopee: produto.precoShopee };
}

export interface RankingUsuarioDiscrepancias {
  usuarioId: number;
  nome: string;
  quantidade: number;
}

export interface LojaMaisDiscrepante {
  lojaId: number;
  nome: string;
  quantidade: number;
}

export interface RankingDiscrepancias {
  usuarios: RankingUsuarioDiscrepancias[];
  lojaMaisDiscrepante: LojaMaisDiscrepante | null;
}

export async function buscarRankingDiscrepancias(): Promise<RankingDiscrepancias> {
  const { rows: usuariosRows } = await pool.query<{ usuario_id: number; nome: string; quantidade: string }>(
    `SELECT u.id AS usuario_id, u.nome, COUNT(*) AS quantidade
     FROM discrepancias d
     JOIN usuarios u ON u.id = d.usuario_id
     GROUP BY u.id, u.nome
     ORDER BY quantidade DESC
     LIMIT 3`
  );

  const { rows: lojaRows } = await pool.query<{ loja_id: number; nome: string; quantidade: string }>(
    `SELECT l.id AS loja_id, l.nome, COUNT(*) AS quantidade
     FROM discrepancias d
     JOIN lojas l ON l.id = d.loja_id
     GROUP BY l.id, l.nome
     ORDER BY quantidade DESC
     LIMIT 1`
  );

  return {
    usuarios: usuariosRows.map((r) => ({ usuarioId: r.usuario_id, nome: r.nome, quantidade: Number(r.quantidade) })),
    lojaMaisDiscrepante:
      lojaRows.length > 0
        ? { lojaId: lojaRows[0].loja_id, nome: lojaRows[0].nome, quantidade: Number(lojaRows[0].quantidade) }
        : null,
  };
}
