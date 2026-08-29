import axios from "axios";
import { pool } from "../db/pool";
import { tokenValido } from "./blingAuth";
import { normalizarSku } from "./financeiroService";

// Padroniza o código do produto no Bling pelo código do site.
//
// O site é o padrão porque o SKU dele vem da planilha que alimenta as lojas. O
// ERP escreve o mesmo produto de outro jeito — `RECICLADA-18KG-PRETO` onde o
// site tem `RECICLADA-18L-PRETO` — e a importação de vendas não reconhece: em
// agosto/2026 foram 87 códigos, R$ 419.285,87, 15% da venda do mês parada.
//
// Nenhum deles é produto novo. É sempre a mesma coisa escrita diferente: KG no
// lugar de L, a unidade faltando, a cor abreviada, vírgula onde é ponto.
//
// Duas travas antes de gravar:
//
//   o destino tem que estar livre    renomear pra um código que já existe faz
//                                    o Bling recusar o save inteiro
//   o produto tem que existir        e com o código exato de origem, senão a
//                                    busca pegou outro parecido
//
// Roda em simulação por padrão. Código de produto é o que liga a venda ao
// cadastro; trocar errado quebra o histórico dos dois lados.

const BASE = "https://api.bling.com.br/Api/v3";
const POR_PAGINA = 100;
// mesmo teto de 3 chamadas por segundo do resto da API
const ESPACO_MS = 350;
const TENTATIVAS = 4;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

let proximaLivre = 0;

async function vez(): Promise<void> {
  const agora = Date.now();
  const quando = Math.max(agora, proximaLivre);
  proximaLivre = quando + ESPACO_MS;
  if (quando > agora) await dormir(quando - agora);
}

async function chamar<T>(
  metodo: "get" | "put" | "post",
  caminho: string,
  params?: Record<string, unknown>,
  corpo?: unknown
): Promise<T> {
  let espera = 2000;
  for (let tentativa = 1; ; tentativa++) {
    await vez();
    const token = await tokenValido();
    try {
      const { data } = await axios.request<T>({
        method: metodo,
        url: `${BASE}${caminho}`,
        params,
        data: corpo,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(corpo ? { "Content-Type": "application/json" } : {}),
        },
        timeout: 30000,
      });
      return data;
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status === 429 && tentativa < TENTATIVAS) {
        await dormir(espera);
        espera *= 2;
        continue;
      }
      if (axios.isAxiosError(err) && err.response) {
        const d = err.response.data as unknown;
        const t = typeof d === "string" ? d : JSON.stringify(d);
        throw new Error(`Bling ${err.response.status}: ${t.slice(0, 300)}`);
      }
      throw err;
    }
  }
}

interface ProdutoBling {
  id: number;
  nome?: string;
  codigo?: string;
  tipo?: string;
  formato?: string;
  [k: string]: unknown;
}

// Procura pelo código exato. Não varre a base: o Bling da Fábrica guarda também
// o catálogo da Fábrica Loja, que vende no Mercado Livre — são milhares de
// produtos, e a listagem inteira a 3 chamadas por segundo não termina.
//
// O filtro volta o que *parece* com o código, então a conferência é aqui, na
// volta, comparando o código normalizado. Confiar no filtro pegaria o vizinho.
async function acharPorCodigo(codigo: string): Promise<ProdutoBling | null> {
  const alvo = normalizarSku(codigo);
  // A busca padrao do Bling nao devolve produto inativo — a mesma armadilha que
  // a listagem tem. Sem o passe de situacao "I", gravar o codigo de barras num
  // produto inativo respondia "nao achei no ERP" com o produto la, parado.
  // Aconteceu com BRILHATELHA-900ML-CHUMBO: inativado por nao ter par no site,
  // e depois vendido de verdade.
  for (const chave of ["codigo", "pesquisa", "criterio"]) {
    try {
      const r = await chamar<{ data?: ProdutoBling[] }>("get", "/produtos", {
        [chave]: codigo,
        limite: POR_PAGINA,
      });
      const achado = (r.data ?? []).find((p) => normalizarSku(p.codigo ?? "") === alvo);
      if (achado) return achado;
    } catch {
      // filtro que o Bling não conhece vira 400: tenta o próximo jeito
    }
  }

  // Ultimo recurso: varrer os inativos com criterio 3.
  //
  // Nenhuma busca por codigo devolve produto inativo. E `situacao: "I"` nao
  // serve: o Bling **ignora** esse filtro em silencio — pedindo situacao "I" ele
  // devolveu 5.071 produtos, todos ativos. Quem separa e o `criterio`: 3 traz os
  // 460 inativos, e so eles.
  //
  // Custa umas cinco chamadas, entao fica por ultimo: o caso comum e produto
  // ativo e resolve na primeira tentativa.
  //
  // Sem isto, gravar o codigo de barras num produto inativo responde "nao achei
  // no ERP" com o produto la, parado — e reativar fica impossivel, que e
  // exatamente quando mais se precisa dele.
  for (let pagina = 1; ; pagina++) {
    let r: { data?: ProdutoBling[] };
    try {
      r = await chamar<{ data?: ProdutoBling[] }>("get", "/produtos", {
        pagina,
        limite: POR_PAGINA,
        criterio: 3,
      });
    } catch {
      break;
    }
    const lote = r.data ?? [];
    const achado = lote.find((p) => normalizarSku(p.codigo ?? "") === alvo);
    if (achado) return achado;
    if (lote.length < POR_PAGINA) break;
  }
  return null;
}

// Lista o catalogo inteiro do Bling.
//
// Diferente dos contatos, aqui varrer compensa: sao ~6 mil produtos, 100 por
// pagina, e o enfileirador de 350ms fecha em menos de meio minuto. O que nao
// termina e a base de contatos, que carrega tambem o cliente final da Fabrica
// Loja — dezenas de milhares.
export interface ProdutoDoBling {
  id: number;
  codigo: string;
  nome: string;
  preco: number | null;
  situacao: string;
  tipo: string;
  formato: string;
}

// O Bling nao devolve o produto inativo na listagem padrao — nem com
// criterio 1, que a documentacao chama de "todos". Entao a leitura roda uma vez
// por filtro e junta: sem isso a conferencia acusa "falta no ERP" pra sempre e
// o cadastro em massa recria o que ja esta la.
//
// `filtros` fica parametrizavel porque qual combinacao funciona depende da
// versao da API, e descobrir isso custa um deploy por tentativa.
export async function listarProdutos(
  aoAndar?: (lidos: number) => void,
  filtros?: Array<Record<string, unknown>>
): Promise<ProdutoDoBling[]> {
  // criterio 2 = ativos, 3 = inativos. O `situacao: "I"` que ficava aqui era
  // placebo: o Bling ignora esse filtro e devolve a lista de ativos como se nada
  // tivesse sido pedido. Quem trazia o inativo sempre foi o criterio 3.
  const combinacoes = filtros?.length ? filtros : [{ criterio: 2 }, { criterio: 3 }];
  const saida: ProdutoDoBling[] = [];
  const vistos = new Set<number>();
  for (const filtro of combinacoes) {
  for (let pagina = 1; ; pagina++) {
    let r: { data?: ProdutoBling[] };
    try {
      r = await chamar<{ data?: ProdutoBling[] }>("get", "/produtos", {
        pagina,
        limite: POR_PAGINA,
        ...filtro,
      });
    } catch {
      // filtro que a API nao conhece vira 400: tenta o proximo
      break;
    }
    const lote = r.data ?? [];
    for (const p of lote) {
      if (vistos.has(p.id)) continue;
      vistos.add(p.id);
      saida.push({
        id: p.id,
        codigo: String(p.codigo ?? "").trim(),
        nome: String(p.nome ?? "").trim(),
        preco: typeof p.preco === "number" ? p.preco : Number(p.preco ?? 0) || null,
        situacao: String(p.situacao ?? ""),
        tipo: String(p.tipo ?? ""),
        formato: String(p.formato ?? ""),
      });
    }
    if (aoAndar) aoAndar(saida.length);
    // pagina incompleta e a ultima: o Bling nao devolve total de registros
    if (lote.length < POR_PAGINA) break;
  }
  }
  return saida;
}

// Confere o catalogo do ERP contra o do site.
//
// Devolve so a divergencia, nao os 5 mil que batem: a lista inteira nao passa
// pela tela, e o que interessa e o que esta diferente.
//
// O preco do Bling e o preco de venda no anuncio, nao o que a Fabrica cobra da
// loja — sao numeros diferentes por natureza, entao aqui so o SKU e comparado.
export interface DivergenciaProduto {
  sku: string;
  ondeEsta: "só no ERP" | "só no site";
  nome: string;
  // no ERP: variacao ou simples. Ajuda a entender pai x filha.
  formato?: string;
  ativoNoSite?: boolean;
}

export interface ConferenciaErp {
  erp: number;
  site: number;
  nosDois: number;
  divergencias: DivergenciaProduto[];
}

export async function conferirContraSite(
  produtosErp: ProdutoDoBling[]
): Promise<ConferenciaErp> {
  const { rows } = await pool.query<{ sku: string; nome: string; ativo: boolean }>(
    "SELECT sku, nome, ativo FROM fabrica_produtos"
  );
  const noSite = new Map(rows.map((r) => [normalizarSku(r.sku), r]));
  const noErp = new Map<string, ProdutoDoBling>();
  for (const p of produtosErp) {
    if (p.codigo) noErp.set(normalizarSku(p.codigo), p);
  }

  const divergencias: DivergenciaProduto[] = [];
  let nosDois = 0;
  for (const [k, p] of noErp) {
    if (noSite.has(k)) nosDois++;
    else divergencias.push({
      sku: p.codigo, ondeEsta: "só no ERP", nome: p.nome, formato: p.formato,
    });
  }
  for (const [k, r] of noSite) {
    if (!noErp.has(k)) {
      divergencias.push({
        sku: r.sku, ondeEsta: "só no site", nome: r.nome, ativoNoSite: r.ativo,
      });
    }
  }
  divergencias.sort((a, b) => a.sku.localeCompare(b.sku));
  return { erp: noErp.size, site: noSite.size, nosDois, divergencias };
}

// Cadastra no ERP o que existe no site e nao la.
//
// O site e o SKU MASTER sao os catalogos completos; o ERP ficou pra tras, com
// um terco do tamanho. Sem o produto la, a venda do dia a dia nao entra.
//
// Nao unifica nada por parecer igual. A EMBORRACHADA que o ERP chama de
// EMBORRACHADA-18KG e fisicamente a mesma tinta de RESIFLEX, INGAFLEX,
// SELATURBO e TELHAFLEX EMBORRACHADA — a fabrica compra sem rotulo e rotula
// conforme o SKU do anuncio. Cada marca tem que ser produto proprio, porque e
// isso que diz quantos rotulos comprar de cada.
//
// O inativo entra so quando pedido, e entra **inativo no Bling tambem**: o
// site diz que aquilo nao esta a venda, e criar como ativo colocaria centenas
// de produtos em circulacao sem ninguem pedir.

export interface LinhaCriacao {
  sku: string;
  nome: string;
  preco: number;
  situacao: "criado" | "já existia" | "erro";
  produtoId?: number;
  erro?: string;
}

export interface ResultadoCriacao {
  simulacao: boolean;
  candidatos: number;
  linhas: LinhaCriacao[];
}

interface ProdutoDoSite {
  sku: string;
  nome: string;
  preco_venda: string;
  ativo: boolean;
}

export async function criarNoErpOqueFalta(
  produtosErp: ProdutoDoBling[],
  simulacao: boolean,
  limite: number,
  incluirInativos: boolean,
  aoAndar?: (feitos: number, total: number) => void
): Promise<ResultadoCriacao> {
  const { rows } = await pool.query<ProdutoDoSite>(
    `SELECT sku, nome, preco_venda, ativo
       FROM fabrica_produtos
      WHERE ($1::boolean OR (ativo = TRUE AND origem = 'DISTRIBUIDORA'))
      ORDER BY sku`,
    [incluirInativos]
  );
  const noErp = new Set(produtosErp.map((p) => normalizarSku(p.codigo)).filter(Boolean));
  const faltam = rows.filter((r) => !noErp.has(normalizarSku(r.sku)));
  const alvo = limite > 0 ? faltam.slice(0, limite) : faltam;

  const linhas: LinhaCriacao[] = [];
  for (let i = 0; i < alvo.length; i++) {
    const r = alvo[i];
    const preco = Number(r.preco_venda) || 0;
    if (simulacao) {
      linhas.push({ sku: r.sku, nome: r.nome, preco, situacao: "criado" });
      continue;
    }
    try {
      const resp = await chamar<{ data?: { id?: number } }>("post", "/produtos", undefined, {
        nome: r.nome,
        codigo: r.sku,
        preco,
        tipo: "P",
        // espelha o site: o que nao vende la nasce inativo aqui
        situacao: r.ativo ? "A" : "I",
        formato: "S",
        unidade: "UN",
      });
      linhas.push({
        sku: r.sku, nome: r.nome, preco, situacao: "criado",
        produtoId: resp.data?.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "falha ao cadastrar";
      // codigo repetido nao e erro: e produto que ja estava la com outra grafia
      linhas.push({
        sku: r.sku, nome: r.nome, preco,
        situacao: /já existe|duplicad|VALIDATION_ERROR/i.test(msg) ? "já existia" : "erro",
        erro: msg.slice(0, 200),
      });
    }
    if (aoAndar) aoAndar(i + 1, alvo.length);
  }
  return { simulacao, candidatos: faltam.length, linhas };
}

// Grava o codigo de barras no produto do ERP.
//
// Os 87 SKUs novos nasceram sem EAN nos quatro lugares. O gerador do site
// produz EAN-13 valido com prefixo 2 — a faixa que o GS1 reserva pra uso
// interno, entao nao colide com codigo de barras real em circulacao.
//
// Grava por leitura e devolucao, igual ao resto: busca o produto inteiro e
// manda de volta so com o gtin trocado. Montar o corpo do zero apagaria preco,
// estoque e fornecedor.
export interface LinhaGtin {
  sku: string;
  gtin: string;
  situacao: "gravado" | "já tinha esse" | "não achei no ERP" | "erro";
  produtoId?: number;
  antes?: string;
  erro?: string;
}

export async function gravarGtin(
  pares: Array<{ sku: string; gtin: string }>,
  simulacao: boolean,
  aoAndar?: (feitos: number, total: number) => void
): Promise<{ simulacao: boolean; linhas: LinhaGtin[] }> {
  const linhas: LinhaGtin[] = [];
  for (let i = 0; i < pares.length; i++) {
    const { sku, gtin } = pares[i];
    try {
      const achado = await acharPorCodigo(sku);
      if (!achado) {
        linhas.push({ sku, gtin, situacao: "não achei no ERP" });
        continue;
      }
      const inteiro = await chamar<{ data: ProdutoBling }>("get", `/produtos/${achado.id}`);
      const antes = String((inteiro.data as { gtin?: string }).gtin ?? "").trim();
      if (antes === gtin) {
        linhas.push({ sku, gtin, situacao: "já tinha esse", produtoId: achado.id, antes });
        continue;
      }
      if (simulacao) {
        linhas.push({ sku, gtin, situacao: "gravado", produtoId: achado.id, antes });
        continue;
      }
      await chamar("put", `/produtos/${achado.id}`, undefined, {
        ...inteiro.data,
        gtin,
      });
      linhas.push({ sku, gtin, situacao: "gravado", produtoId: achado.id, antes });
    } catch (err) {
      linhas.push({
        sku, gtin, situacao: "erro",
        erro: err instanceof Error ? err.message : "falha ao gravar",
      });
    }
    if (aoAndar) aoAndar(i + 1, pares.length);
  }
  return { simulacao, linhas };
}

// Inativa produto no ERP.
//
// Inativa, nunca exclui. O pedido antigo aponta pro produto: excluir arrisca
// orfao e o Bling costuma recusar quando ha movimento. Inativo some da
// operacao do dia a dia e volta com um clique se for preciso.
export interface LinhaInativacao {
  sku: string;
  situacao:
    | "inativado"
    | "reativado"
    | "já estava inativo"
    | "já estava ativo"
    | "não achei no ERP"
    | "erro";
  produtoId?: number;
  erro?: string;
}

// Liga ou desliga o produto no ERP.
//
// So desligar nao bastava. O Hudson mandou inativar os 106 codigos sem par no
// site — e um deles, BRILHATELHA-900ML-CHUMBO, vendeu de verdade em agosto. Cor
// nova nasce assim: aparece na venda antes de existir no cadastro. Sem caminho
// de volta, o conserto virava trabalho manual dentro do Bling.
export async function definirSituacaoProdutos(
  skus: string[],
  situacao: "A" | "I",
  simulacao: boolean,
  aoAndar?: (feitos: number, total: number) => void
): Promise<{ simulacao: boolean; linhas: LinhaInativacao[] }> {
  const linhas: LinhaInativacao[] = [];
  for (let i = 0; i < skus.length; i++) {
    const sku = skus[i];
    try {
      const achado = await acharPorCodigo(sku);
      if (!achado) {
        linhas.push({ sku, situacao: "não achei no ERP" });
        continue;
      }
      const inteiro = await chamar<{ data: ProdutoBling }>("get", `/produtos/${achado.id}`);
      if (String(inteiro.data.situacao ?? "").toUpperCase() === situacao) {
        linhas.push({
          sku,
          situacao: situacao === "I" ? "já estava inativo" : "já estava ativo",
          produtoId: achado.id,
        });
        continue;
      }
      if (!simulacao) {
        // leitura e devolucao: so a situacao muda, o resto volta como veio
        await chamar("put", `/produtos/${achado.id}`, undefined, {
          ...inteiro.data,
          situacao,
        });
      }
      linhas.push({
        sku,
        situacao: situacao === "I" ? "inativado" : "reativado",
        produtoId: achado.id,
      });
    } catch (err) {
      linhas.push({
        sku, situacao: "erro",
        erro: err instanceof Error ? err.message : "falha ao mudar a situação",
      });
    }
    if (aoAndar) aoAndar(i + 1, skus.length);
  }
  return { simulacao, linhas };
}

export function inativarProdutos(
  skus: string[],
  simulacao: boolean,
  aoAndar?: (feitos: number, total: number) => void
) {
  return definirSituacaoProdutos(skus, "I", simulacao, aoAndar);
}

export interface ParPadronizacao {
  de: string;
  para: string;
}

export interface LinhaPadronizacao {
  de: string;
  para: string;
  produtoId: number | null;
  nome: string | null;
  situacao:
    | "renomeado"
    | "já está certo"
    | "não achei no Bling"
    | "destino ocupado"
    | "fora do catálogo do site"
    | "erro";
  detalhe?: string;
}

export interface ResultadoPadronizacao {
  simulacao: boolean;
  pares: number;
  linhas: LinhaPadronizacao[];
}

export async function padronizarCodigos(
  pares: ParPadronizacao[],
  simulacao: boolean
): Promise<ResultadoPadronizacao> {
  // O destino tem que ser um SKU que existe aqui. Renomear pra um código que o
  // site não conhece só mudaria o lugar do problema.
  const { rows } = await pool.query<{ sku: string }>("SELECT sku FROM fabrica_produtos");
  const doSite = new Set(rows.map((r) => normalizarSku(r.sku)));

  const linhas: LinhaPadronizacao[] = [];
  for (const par of pares) {
    const de = String(par.de ?? "").trim();
    const para = String(par.para ?? "").trim();
    if (!de || !para) continue;

    if (!doSite.has(normalizarSku(para))) {
      linhas.push({
        de,
        para,
        produtoId: null,
        nome: null,
        situacao: "fora do catálogo do site",
      });
      continue;
    }

    let origem: ProdutoBling | null;
    try {
      origem = await acharPorCodigo(de);
    } catch (err) {
      linhas.push({
        de,
        para,
        produtoId: null,
        nome: null,
        situacao: "erro",
        detalhe: err instanceof Error ? err.message : "falha ao procurar",
      });
      continue;
    }
    if (!origem) {
      linhas.push({ de, para, produtoId: null, nome: null, situacao: "não achei no Bling" });
      continue;
    }
    if (normalizarSku(origem.codigo ?? "") === normalizarSku(para)) {
      linhas.push({
        de,
        para,
        produtoId: origem.id,
        nome: origem.nome ?? null,
        situacao: "já está certo",
      });
      continue;
    }

    // destino ocupado: o Bling recusaria o save, e sobrescrever calado juntaria
    // dois produtos diferentes no mesmo código
    const ocupado = await acharPorCodigo(para);
    if (ocupado && ocupado.id !== origem.id) {
      linhas.push({
        de,
        para,
        produtoId: origem.id,
        nome: origem.nome ?? null,
        situacao: "destino ocupado",
        detalhe: `o código ${para} já é do produto ${ocupado.id}`,
      });
      continue;
    }

    if (simulacao) {
      linhas.push({
        de,
        para,
        produtoId: origem.id,
        nome: origem.nome ?? null,
        situacao: "renomeado",
      });
      continue;
    }

    try {
      // leitura e devolução: manda o produto inteiro de volta com o código
      // trocado. Montar o corpo do zero apagaria preço, estoque, fornecedor.
      const inteiro = await chamar<{ data: ProdutoBling }>("get", `/produtos/${origem.id}`);
      await chamar("put", `/produtos/${origem.id}`, undefined, {
        ...inteiro.data,
        codigo: para,
      });
      linhas.push({
        de,
        para,
        produtoId: origem.id,
        nome: origem.nome ?? null,
        situacao: "renomeado",
      });
    } catch (err) {
      linhas.push({
        de,
        para,
        produtoId: origem.id,
        nome: origem.nome ?? null,
        situacao: "erro",
        detalhe: err instanceof Error ? err.message : "falha ao gravar",
      });
    }
  }

  return { simulacao, pares: linhas.length, linhas };
}

// ---------------------------------------------------------------------------
// Grava o preço de venda no produto do ERP.
//
// O ERP tinha caminho pra código de barras e pra situação, e nenhum pra preço —
// e é o preço que sai na nota. Mudar no site e não mudar lá deixa a loja
// recebendo um documento com um valor e o sistema dizendo outro.
//
// Leitura e devolução, igual ao GTIN: busca o produto inteiro, troca só o preço
// e manda o resto de volta como veio. Montar o corpo do zero apagaria o que o
// Bling guarda e a gente não modela.

export interface LinhaPreco {
  sku: string;
  preco: number;
  situacao: "gravado" | "já era esse" | "não achei no ERP" | "erro";
  produtoId?: number;
  antes?: number;
  erro?: string;
}

export async function gravarPreco(
  pares: Array<{ sku: string; preco: number }>,
  simulacao: boolean,
  aoAndar?: (feitos: number, total: number) => void
): Promise<{ simulacao: boolean; linhas: LinhaPreco[] }> {
  const linhas: LinhaPreco[] = [];
  for (let i = 0; i < pares.length; i++) {
    const { sku, preco } = pares[i];
    try {
      const achado = await acharPorCodigo(sku);
      if (!achado) {
        linhas.push({ sku, preco, situacao: "não achei no ERP" });
        continue;
      }
      const inteiro = await chamar<{ data: ProdutoBling }>("get", `/produtos/${achado.id}`);
      const antes = Number((inteiro.data as { preco?: number | string }).preco ?? 0);
      // centavo: comparar float direto marcaria 359.1 e 359.10 como diferentes
      if (Math.abs(antes - preco) < 0.005) {
        linhas.push({ sku, preco, situacao: "já era esse", produtoId: achado.id, antes });
        continue;
      }
      if (!simulacao) {
        await chamar("put", `/produtos/${achado.id}`, undefined, {
          ...inteiro.data,
          preco,
        });
      }
      linhas.push({ sku, preco, situacao: "gravado", produtoId: achado.id, antes });
    } catch (err) {
      linhas.push({
        sku, preco, situacao: "erro",
        erro: err instanceof Error ? err.message : "falha ao gravar o preço",
      });
    }
    if (aoAndar) aoAndar(i + 1, pares.length);
  }
  return { simulacao, linhas };
}
