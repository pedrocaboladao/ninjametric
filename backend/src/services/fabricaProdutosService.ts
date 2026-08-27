import { pool } from "../db/pool";
import { listarFormulas } from "./fabricacaoService";

// Produto acabado da Fábrica Distribuidora — o que ela vende para as lojas
// do grupo. Fica separado de `produtos` (que é catálogo de anúncio do Mercado
// Livre, das 20 lojas) de propósito: são operações diferentes.
//
// Dois tipos de produto convivem aqui:
//
// - FABRICA: sai de uma fórmula. O custo NÃO é guardado — vem da fórmula, e se
//   recalcula sozinho quando a resina muda de preço.
// - DISTRIBUIDORA: comprado pronto pra revender. Aí o custo é digitado, porque
//   não há receita pra derivar: o que se sabe é o que se pagou ao fornecedor.
//
// Ter as duas regras no mesmo lugar exige que `origem` decida qual vale. Sem
// isso, produto de revenda ficava com custo zero e a margem aparecia como 100%.
export interface FabricaProduto {
  id: number;
  sku: string;
  nome: string;
  origem: "FABRICA" | "DISTRIBUIDORA";
  // REVENDA vira anúncio no Mercado Livre; INSUMO a expedição consome — caixa,
  // saco, fita. É por isso que insumo não pertence ao SKU MASTER.
  tipo: "REVENDA" | "INSUMO";
  ean: string | null;
  familia: string | null;
  // só na revenda: no produto de fábrica o custo vem da fórmula, e um número
  // digitado ao lado dele criaria duas verdades
  custoCompra: number | null;
  formulaId: number | null;
  formulaNome: string | null;
  embalagemId: number | null;
  embalagemNome: string | null;
  pesoKg: number;
  custoPorKgTeorico: number;
  custoPorKgReal: number;
  rendimento: number;
  lotes: number;
  custoTeorico: number;
  custoProduto: number;
  custoEmbalagem: number;
  custo: number;
  precoVenda: number;
  margemContribuicao: number;
  markup: number;
  percentualLucro: number;
  // por que o custo deu zero: lista vazia quando não deu
  semCusto: string[];
  ativo: boolean;
}

export interface ProdutoEntrada {
  sku: string;
  nome: string;
  origem: "FABRICA" | "DISTRIBUIDORA";
  tipo: "REVENDA" | "INSUMO";
  ean: string | null;
  familia: string | null;
  custoCompra: number | null;
  formulaId: number | null;
  embalagemId: number | null;
  precoVenda: number;
  ativo: boolean;
}

interface LinhaBruta {
  id: number;
  tipo: string;
  sku: string;
  nome: string;
  origem: string;
  ean: string | null;
  familia: string | null;
  custo_compra: string | null;
  formula_id: number | null;
  formula_nome: string | null;
  embalagem_id: number | null;
  embalagem_nome: string | null;
  peso_kg: string | null;
  custo_embalagem: string | null;
  preco_venda: string;
  ativo: boolean;
}

interface Rendimento {
  previsto: number;
  real: number;
  lotes: number;
}

// Rendimento acumulado de cada fórmula, somando TODOS os lotes já lançados.
//
// A matéria-prima é pesada exatamente pela receita, então o dinheiro gasto num
// lote é fixo (custo teórico × peso previsto). O que varia é quanto sai do
// tanque: mais água ou menos espessante rende mais, e o mesmo dinheiro se
// dilui em mais quilos. Somar previsto e real de todos os lotes antes de
// dividir dá a média ponderada natural — lote grande pesa mais que lote
// pequeno, sem precisar ponderar à mão.
async function rendimentoPorFormula(): Promise<Map<number, Rendimento>> {
  const { rows } = await pool.query<{
    formula_id: number;
    previsto: string;
    real: string;
    lotes: string;
  }>(
    `SELECT formula_id,
            SUM(peso_previsto_kg) AS previsto,
            SUM(peso_real_kg)     AS real,
            COUNT(*)              AS lotes
     FROM formula_lotes
     GROUP BY formula_id`
  );
  return new Map(
    rows.map((r) => [
      r.formula_id,
      { previsto: Number(r.previsto), real: Number(r.real), lotes: Number(r.lotes) },
    ])
  );
}

function calcularIndicadores(custo: number, precoVenda: number) {
  const margemContribuicao = precoVenda - custo;
  return {
    margemContribuicao,
    markup: custo > 0 ? margemContribuicao / custo : 0,
    percentualLucro: precoVenda > 0 ? margemContribuicao / precoVenda : 0,
  };
}

function montar(
  r: LinhaBruta,
  custoTeoricoPorFormula: Map<number, number>,
  rendimentos: Map<number, Rendimento>
): FabricaProduto {
  const revenda = r.origem === "DISTRIBUIDORA";
  const custoCompra = r.custo_compra !== null ? Number(r.custo_compra) : null;
  const custoPorKgTeorico = r.formula_id !== null ? custoTeoricoPorFormula.get(r.formula_id) ?? 0 : 0;
  const rend = r.formula_id !== null ? rendimentos.get(r.formula_id) : undefined;

  // Sem lote lançado ainda, o teórico é a única referência que existe.
  const temRendimento = !!rend && rend.real > 0 && rend.previsto > 0;
  const custoPorKgReal = temRendimento
    ? (custoPorKgTeorico * rend!.previsto) / rend!.real
    : custoPorKgTeorico;
  const rendimento = temRendimento ? rend!.real / rend!.previsto - 1 : 0;

  const pesoKg = r.peso_kg !== null ? Number(r.peso_kg) : 0;
  const custoEmbalagem = r.custo_embalagem !== null ? Number(r.custo_embalagem) : 0;
  // na revenda não há peso nem embalagem a somar: o que se pagou pelo produto
  // pronto já é o custo inteiro dele
  const custoProduto = revenda ? custoCompra ?? 0 : custoPorKgReal * pesoKg;
  const custo = revenda ? custoCompra ?? 0 : custoProduto + custoEmbalagem;
  const precoVenda = Number(r.preco_venda);

  // Por que o custo deu zero.
  //
  // Custo zero não avisa: ele vira margem de 100%, e produto com margem de 100%
  // parece o melhor do catálogo. Seis EMBORRACHADO CERÂMICA ficaram meses
  // assim — a fórmula tinha as seis embalagens calculadas, mas o produto não
  // estava ligado a nenhuma, então o site não sabia qual custo puxar.
  const semCusto: string[] = [];
  if (custo <= 0) {
    if (revenda) {
      semCusto.push("custo de compra não preenchido");
    } else {
      if (r.formula_id === null) semCusto.push("sem fórmula");
      else if (custoPorKgTeorico <= 0) semCusto.push("a fórmula está com custo zero");
      if (r.embalagem_id === null) semCusto.push("sem embalagem ligada");
      else if (pesoKg <= 0) semCusto.push("a embalagem está sem peso");
    }
  }

  return {
    id: r.id,
    sku: r.sku,
    nome: r.nome,
    origem: (r.origem === "DISTRIBUIDORA" ? "DISTRIBUIDORA" : "FABRICA") as
      | "FABRICA"
      | "DISTRIBUIDORA",
    // o padrão é revenda: insumo é a exceção, e marcar errado pra menos só
    // deixa a coisa no catálogo — marcar errado pra mais some com ela
    tipo: (r.tipo === "INSUMO" ? "INSUMO" : "REVENDA") as "REVENDA" | "INSUMO",
    ean: r.ean,
    familia: r.familia,
    custoCompra,
    formulaId: r.formula_id,
    formulaNome: r.formula_nome,
    embalagemId: r.embalagem_id,
    embalagemNome: r.embalagem_nome,
    // o que falta pro custo sair de zero; vazio quando está tudo certo
    semCusto,
    pesoKg,
    custoPorKgTeorico,
    custoPorKgReal,
    rendimento,
    lotes: rend?.lotes ?? 0,
    custoTeorico: revenda ? custoCompra ?? 0 : custoPorKgTeorico * pesoKg + custoEmbalagem,
    custoProduto,
    custoEmbalagem,
    custo,
    precoVenda,
    ativo: r.ativo,
    ...calcularIndicadores(custo, precoVenda),
  };
}

const SELECT_BASE = `
  SELECT p.id, p.sku, p.nome, p.origem, p.tipo, p.ean, p.familia, p.custo_compra,
         p.formula_id, f.nome AS formula_nome,
         p.embalagem_id, e.nome AS embalagem_nome, e.peso_kg, e.custo_embalagem,
         p.preco_venda, p.ativo
  FROM fabrica_produtos p
  LEFT JOIN formulas f ON f.id = p.formula_id
  LEFT JOIN formula_embalagens e ON e.id = p.embalagem_id
`;

async function contexto() {
  const [formulas, rendimentos] = await Promise.all([listarFormulas(), rendimentoPorFormula()]);
  return {
    custoTeorico: new Map(formulas.map((f) => [f.id, f.custoPorKg])),
    rendimentos,
  };
}

export async function listarProdutos(): Promise<FabricaProduto[]> {
  const { custoTeorico, rendimentos } = await contexto();
  const { rows } = await pool.query<LinhaBruta>(`${SELECT_BASE} ORDER BY p.nome`);
  return rows.map((r) => montar(r, custoTeorico, rendimentos));
}

export async function obterProduto(id: number): Promise<FabricaProduto | null> {
  const { custoTeorico, rendimentos } = await contexto();
  const { rows } = await pool.query<LinhaBruta>(`${SELECT_BASE} WHERE p.id = $1`, [id]);
  return rows[0] ? montar(rows[0], custoTeorico, rendimentos) : null;
}

// A embalagem tem de pertencer à fórmula escolhida — senão o custo sairia de
// uma combinação que não existe na produção.
async function validarEmbalagem(formulaId: number | null, embalagemId: number | null): Promise<void> {
  if (embalagemId === null) return;
  if (formulaId === null) throw new Error("Escolha a fórmula antes da embalagem.");
  const { rows } = await pool.query<{ formula_id: number }>(
    "SELECT formula_id FROM formula_embalagens WHERE id = $1",
    [embalagemId]
  );
  if (!rows[0]) throw new Error("Embalagem não encontrada.");
  if (rows[0].formula_id !== formulaId) throw new Error("Essa embalagem é de outra fórmula.");
}

export async function criarProduto(entrada: ProdutoEntrada): Promise<{ id: number }> {
  // produto de revenda nao tem formula nem embalagem da fabrica pra validar
  if (entrada.origem === "FABRICA") {
    await validarEmbalagem(entrada.formulaId, entrada.embalagemId);
  }
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO fabrica_produtos
       (sku, nome, formula_id, embalagem_id, preco_venda, ativo,
        origem, ean, familia, custo_compra, tipo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      entrada.sku,
      entrada.nome,
      entrada.formulaId,
      entrada.embalagemId,
      entrada.precoVenda,
      entrada.ativo,
      entrada.origem,
      entrada.ean,
      entrada.familia,
      entrada.custoCompra,
      entrada.tipo,
    ]
  );
  return { id: rows[0].id };
}

export async function atualizarProduto(id: number, entrada: ProdutoEntrada): Promise<void> {
  if (entrada.origem === "FABRICA") {
    await validarEmbalagem(entrada.formulaId, entrada.embalagemId);
  }
  await pool.query(
    `UPDATE fabrica_produtos
     SET sku = $2, nome = $3, formula_id = $4, embalagem_id = $5, preco_venda = $6,
         ativo = $7, origem = $8, ean = $9, familia = $10, custo_compra = $11,
         tipo = $12
     WHERE id = $1`,
    [
      id,
      entrada.sku,
      entrada.nome,
      entrada.formulaId,
      entrada.embalagemId,
      entrada.precoVenda,
      entrada.ativo,
      entrada.origem,
      entrada.ean,
      entrada.familia,
      entrada.custoCompra,
      entrada.tipo,
    ]
  );
}

export async function excluirProduto(id: number): Promise<void> {
  await pool.query("DELETE FROM fabrica_produtos WHERE id = $1", [id]);
}

// --- importar o catálogo -----------------------------------------------------
//
// Os produtos de revenda são os mesmos que o catálogo do Mercado Livre já
// lista, com o mesmo SKU. Em vez de digitar cinco mil linhas, lê de lá.
//
// É leitura pura: o catálogo é uma planilha do Google Sheets que o
// `produtosService` busca por CSV, e nada aqui escreve nela. O SKU repetido
// também não colide — `fabrica_produtos` e a planilha são universos separados,
// e usar o mesmo código é justamente o que deixa a conferência com a loja
// trivial.
//
// O "custo" da planilha é o que a LOJA paga, ou seja, o preço que a fábrica
// cobra dela: entra como preço de venda. O custo de compra, o que a fábrica
// pagou ao fornecedor, fica em branco pro Hudson preencher — esse número não
// existe em lugar nenhum do sistema ainda.

export interface ResultadoImportacaoCatalogo {
  criados: number;
  jaExistiam: number;
  semSku: number;
  familias: number;
}

// "706-FITA/FRONTEC-1.10MX20M" -> "706-FITA/FRONTEC". A planilha agrupa por
// essa família, e é por ela que dá pra filtrar quando são 5 mil SKUs.
function familiaDoSku(sku: string): string {
  const semTamanho = sku.replace(/[-/]\d+([.,]\d+)?\s*(KG|L|MX|M|G|ML|PC|UN)\b.*$/i, "");
  const pedacos = semTamanho.split(/[-/]/).filter(Boolean);
  return (pedacos.length > 1 ? pedacos.slice(0, -1).join("-") : pedacos[0] || sku).toUpperCase();
}

export async function importarCatalogo(): Promise<ResultadoImportacaoCatalogo> {
  const { listarProdutos } = await import("./produtosService");
  const catalogo = await listarProdutos();

  const { rows } = await pool.query<{ sku: string }>("SELECT sku FROM fabrica_produtos");
  const existentes = new Set(rows.map((r) => r.sku.trim().toUpperCase()));

  const familias = new Set<string>();
  let criados = 0;
  let jaExistiam = 0;
  let semSku = 0;

  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    for (const p of catalogo) {
      const sku = p.sku.trim();
      if (!sku) {
        semSku += 1;
        continue;
      }
      // SKU que já existe não é tocado: o produto de fábrica com o mesmo código
      // tem custo vindo da fórmula, e sobrescrever apagaria isso
      if (existentes.has(sku.toUpperCase())) {
        jaExistiam += 1;
        continue;
      }
      const familia = familiaDoSku(sku);
      familias.add(familia);
      await cliente.query(
        `INSERT INTO fabrica_produtos
           (sku, nome, formula_id, embalagem_id, preco_venda, ativo, origem, ean, familia, custo_compra)
         VALUES ($1,$2,NULL,NULL,$3,TRUE,'DISTRIBUIDORA',$4,$5,NULL)`,
        [sku, sku, p.custo, p.ean || null, familia]
      );
      existentes.add(sku.toUpperCase());
      criados += 1;
    }
    await cliente.query("COMMIT");
  } catch (err) {
    await cliente.query("ROLLBACK");
    throw err;
  } finally {
    cliente.release();
  }

  return { criados, jaExistiam, semSku, familias: familias.size };
}

// --- conferir preços com a planilha -----------------------------------------
//
// A tela do Pedro é espelho vivo do Google Sheets: ele muda o custo lá e a tela
// muda sozinha. Aqui os produtos de revenda são uma cópia, então ficariam
// congelados no preço do dia da importação.
//
// O meio-termo que o Hudson escolheu: o preço continua vindo da planilha, mas
// passa pelos olhos dele antes. Alterar preço de venda sem ninguém saber é o
// tipo de coisa que só aparece três meses depois, no DRE.

export interface DiferencaPreco {
  id: number;
  sku: string;
  nome: string;
  precoAtual: number;
  precoPlanilha: number;
  diferenca: number;
}

export interface ConferenciaCatalogo {
  diferencas: DiferencaPreco[];
  conferidos: number;
  // está no cadastro mas sumiu da planilha: produto que saiu de linha
  foraDaPlanilha: { id: number; sku: string; nome: string }[];
}

export async function conferirPrecosCatalogo(): Promise<ConferenciaCatalogo> {
  const { listarProdutos } = await import("./produtosService");
  const catalogo = await listarProdutos();
  const porSku = new Map(catalogo.map((p) => [p.sku.trim().toUpperCase(), p]));

  const { rows } = await pool.query<{
    id: number;
    sku: string;
    nome: string;
    preco_venda: string;
  }>(
    `SELECT id, sku, nome, preco_venda FROM fabrica_produtos
     WHERE origem = 'DISTRIBUIDORA' ORDER BY nome`
  );

  const diferencas: DiferencaPreco[] = [];
  const foraDaPlanilha: { id: number; sku: string; nome: string }[] = [];

  for (const r of rows) {
    const daPlanilha = porSku.get(r.sku.trim().toUpperCase());
    if (!daPlanilha) {
      foraDaPlanilha.push({ id: r.id, sku: r.sku, nome: r.nome });
      continue;
    }
    const atual = Number(r.preco_venda);
    // centavo de diferença é arredondamento, não reajuste
    if (Math.abs(atual - daPlanilha.custo) < 0.005) continue;
    diferencas.push({
      id: r.id,
      sku: r.sku,
      nome: r.nome,
      precoAtual: atual,
      precoPlanilha: daPlanilha.custo,
      diferenca: daPlanilha.custo - atual,
    });
  }

  diferencas.sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca));
  return { diferencas, conferidos: rows.length, foraDaPlanilha };
}

// Aplica só o que veio na lista: o Hudson viu a diferença antes de mandar.
export async function aplicarPrecosCatalogo(
  ids: number[]
): Promise<{ atualizados: number }> {
  if (!ids.length) return { atualizados: 0 };
  const { diferencas } = await conferirPrecosCatalogo();
  const querer = new Set(ids);
  const aplicar = diferencas.filter((d) => querer.has(d.id));

  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    for (const d of aplicar) {
      // só produto de revenda: o preço do fabricado é decisão do Hudson, não
      // da planilha do catálogo
      await cliente.query(
        `UPDATE fabrica_produtos SET preco_venda = $2
         WHERE id = $1 AND origem = 'DISTRIBUIDORA'`,
        [d.id, d.precoPlanilha]
      );
    }
    await cliente.query("COMMIT");
  } catch (err) {
    await cliente.query("ROLLBACK");
    throw err;
  } finally {
    cliente.release();
  }
  return { atualizados: aplicar.length };
}
