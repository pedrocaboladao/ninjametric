import { pool } from "../db/pool";
import { normalizarSku } from "./financeiroService";

// Como o ERP chama cada produto.
//
// O par do apelido de cliente. O Bling escreve `RECICLADA-18KG-PRETO` onde o
// catálogo tem `RECICLADA-18L-PRETO` e a linha não casa — em agosto/2026 foram
// 88 códigos, R$ 424.857, 15% da venda do mês.
//
// Padronizar o código no ERP não resolve o passado: o Bling **grava o código
// dentro do pedido**, congelado na hora da venda. Os 74 renomes de 27/08/2026
// valem da próxima venda em diante; agosto continua com a foto do código
// velho, e é aqui que ele casa.
//
// São três jeitos, nesta ordem:
//
//   1. SKU igual     o caminho normal
//   2. apelido       o que foi ensinado uma vez e vale pra sempre
//   3. frouxo        a mesma coisa escrita diferente — ver `chaveFrouxa`
//
// O frouxo só vale quando **um** produto casa. Se dois casarem, a linha fica em
// aberto pra alguém dizer qual é: lançar a venda no produto errado bagunça
// estoque e margem de dois SKUs de uma vez.

export interface ProdutoApelido {
  id: number;
  produtoId: number;
  produtoSku: string;
  apelido: string;
}

export function chaveApelidoSku(sku: string): string {
  return normalizarSku(String(sku ?? "").trim());
}

// O mesmo produto escrito de outro jeito.
//
// Quatro diferenças, todas vistas de verdade no Bling da Fábrica:
//
//   16KG e 16L        é o mesmo balde; a unidade no código é rótulo, não medida
//   RECICLADA-18-     a unidade sumiu
//   3,6KG e 3.6KG     vírgula decimal
//   VERMELHOOX,
//   VERMELHOOXIDO     a cor abreviada, e AZIL que é AZUL digitado torto
//
// O tamanho **não** é ignorado: 16 e 18 continuam diferentes, porque
// RESIFLEXPISOFOSCO existe nos dois e são produtos distintos. Esse caso é de
// apelido, não de regra.
export function chaveFrouxa(sku: string): string {
  let t = String(sku ?? "").toUpperCase();
  const acento: Record<string, string> = {
    Á: "A", À: "A", Ã: "A", Â: "A", É: "E", Ê: "E", Í: "I",
    Ó: "O", Õ: "O", Ô: "O", Ú: "U", Ç: "C",
  };
  t = t.replace(/[ÁÀÃÂÉÊÍÓÕÔÚÇ]/g, (c) => acento[c] ?? c);
  t = t.replace(/AZIL/g, "AZUL");
  t = t.replace(/VERMELHO\s*O?X(IDO)?/g, "VERMELHOXIDO");
  t = t.replace(/ARGAMASSAPOL(?!I)/g, "ARGAMASSAPOLI");
  // vírgula decimal vira ponto antes de qualquer limpeza
  t = t.replace(/(\d),(\d)/g, "$1.$2");
  t = t.replace(/[^A-Z0-9.]+/g, " ");
  // número seguido de unidade vira só o número
  t = t.replace(/(\d+(?:\.\d+)?)\s*(KG|L|ML|UN)\b/g, "$1");
  return t.replace(/\s+/g, "").replace(/(\d)\.0+(?!\d)/g, "$1");
}

export interface ProdutoBasico {
  id: number;
  sku: string;
}

export function casarProduto<T extends ProdutoBasico>(
  sku: string,
  porSku: Map<string, T>,
  porApelido: Map<string, T>,
  porFrouxa: Map<string, T[]>
): { produto: T | null; ambiguo: boolean } {
  const chave = chaveApelidoSku(sku);
  if (!chave) return { produto: null, ambiguo: false };

  const direto = porSku.get(chave) ?? porApelido.get(chave);
  if (direto) return { produto: direto, ambiguo: false };

  const candidatos = porFrouxa.get(chaveFrouxa(sku)) ?? [];
  if (candidatos.length === 1) return { produto: candidatos[0], ambiguo: false };
  return { produto: null, ambiguo: candidatos.length > 1 };
}

// Monta o índice frouxo. Fica separado da consulta porque a conferência roda
// isso em milhares de linhas e o índice é o mesmo pra todas.
export function indiceFrouxo<T extends ProdutoBasico>(produtos: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const p of produtos) {
    const k = chaveFrouxa(p.sku);
    const lista = m.get(k);
    if (lista) lista.push(p);
    else m.set(k, [p]);
  }
  return m;
}

export async function listarApelidosSku(): Promise<ProdutoApelido[]> {
  const { rows } = await pool.query<{
    id: number;
    produto_id: number;
    sku: string;
    apelido: string;
  }>(
    `SELECT a.id, a.produto_id, p.sku, a.apelido
       FROM fabrica_produto_apelidos a
       JOIN fabrica_produtos p ON p.id = a.produto_id
      ORDER BY p.sku, a.apelido`
  );
  return rows.map((r) => ({
    id: r.id,
    produtoId: r.produto_id,
    produtoSku: r.sku,
    apelido: r.apelido,
  }));
}

export async function criarApelidoSku(
  produtoId: number,
  apelido: string
): Promise<ProdutoApelido> {
  const nome = String(apelido ?? "").trim();
  const chave = chaveApelidoSku(nome);
  if (!chave) throw new Error("Informe o código que o ERP usa.");

  const { rows: dono } = await pool.query<{ id: number; sku: string }>(
    "SELECT id, sku FROM fabrica_produtos WHERE id = $1",
    [produtoId]
  );
  if (!dono.length) throw new Error("Produto não encontrado.");

  // Já apontando pra outro produto: trocar calado moveria a venda de SKU sem
  // ninguém pedir, e leva estoque e margem junto.
  const { rows: existe } = await pool.query<{ sku: string; produto_id: number }>(
    `SELECT p.sku, a.produto_id
       FROM fabrica_produto_apelidos a
       JOIN fabrica_produtos p ON p.id = a.produto_id
      WHERE a.chave = $1`,
    [chave]
  );
  if (existe.length) {
    throw new Error(
      existe[0].produto_id === produtoId
        ? `"${nome}" já está ligado a ${existe[0].sku}.`
        : `"${nome}" já está ligado a ${existe[0].sku}. Apague aquele apelido antes de ligar aqui.`
    );
  }

  const { rows } = await pool.query<{ id: number }>(
    "INSERT INTO fabrica_produto_apelidos (produto_id, apelido, chave) VALUES ($1, $2, $3) RETURNING id",
    [produtoId, nome, chave]
  );
  return { id: rows[0].id, produtoId, produtoSku: dono[0].sku, apelido: nome };
}

export async function excluirApelidoSku(id: number): Promise<void> {
  await pool.query("DELETE FROM fabrica_produto_apelidos WHERE id = $1", [id]);
}
