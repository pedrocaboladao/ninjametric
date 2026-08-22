import { pool } from "../db/pool";
import { listarVendasFinanceiras, normalizarSku } from "./financeiroService";

// Vendas do Mercado Livre viram pedido da Fábrica.
//
// As lojas trabalham com estoque zero — só pegam o que venderam — e a expedição
// fica no mesmo galpão do estoque da fábrica. Então a venda no ML *é* a
// retirada do estoque: não é uma aproximação do pedido, é o mesmo evento visto
// do outro lado do balcão.
//
// Hoje o Hudson recebe a lista de cada loja e digita à mão. Isso lê o que a API
// já sabe — 98,6% das unidades casam com o cadastro, e o que não casa aparece
// marcado pra ele cadastrar na hora, em vez de sumir.
//
// O ciclo é de 7 dias, mas o dia 8 já gera compra nova e sobra pedaço do dia 7
// que ficou fora do fechamento. Por isso cada item de ordem importado fica
// registrado: a mesma venda não entra em dois pedidos.

export interface LinhaVendaMl {
  sku: string;
  // o que a API mandou, antes de normalizar — é o que o Hudson vê no anúncio
  titulo: string;
  quantidade: number;
  produtoId: number | null;
  produtoNome: string | null;
  precoUnitario: number;
  total: number;
  // já entrou em algum pedido? então não entra de novo
  jaImportado: boolean;
  pedidoId: number | null;
}

export interface VendasDaLoja {
  lojaId: number;
  lojaNome: string;
  clienteId: number | null;
  clienteNome: string | null;
  linhas: LinhaVendaMl[];
  itens: number;
  unidades: number;
  total: number;
  semCadastro: number;
  jaImportados: number;
}

export interface ConferenciaVendasMl {
  de: string;
  ate: string;
  lojas: VendasDaLoja[];
  // SKU vendido que não existe no cadastro da fábrica: o Hudson cadastra e
  // roda de novo
  semCadastro: { sku: string; titulo: string; unidades: number; lojas: string[] }[];
  totalUnidades: number;
  totalValor: number;
}

interface ProdutoLinha {
  id: number;
  sku: string;
  nome: string;
  preco_venda: string;
  ativo: boolean;
}

export async function conferirVendasMl(
  de: string,
  ate: string
): Promise<ConferenciaVendasMl> {
  const [financeiro, produtos, clientes, importados] = await Promise.all([
    // todas as lojas: a fábrica vende pra todas, e o filtro por loja é da tela
    listarVendasFinanceiras(undefined, undefined, de, ate),
    pool.query<ProdutoLinha>(
      "SELECT id, sku, nome, preco_venda, ativo FROM fabrica_produtos WHERE ativo = TRUE"
    ),
    pool.query<{ id: number; nome: string; loja_id: number | null }>(
      "SELECT id, nome, loja_id FROM fabrica_clientes"
    ),
    pool.query<{ order_id: string; item_id: string; pedido_id: number | null }>(
      "SELECT order_id, item_id, pedido_id FROM fabrica_ml_importado"
    ),
  ]);

  const porSku = new Map<string, ProdutoLinha>();
  for (const p of produtos.rows) porSku.set(normalizarSku(p.sku), p);

  // o vínculo gravado manda; o nome é só o encosto pra quem ainda não ligou
  const porLojaId = new Map<number, { id: number; nome: string }>();
  const porNome = new Map<string, { id: number; nome: string }>();
  for (const c of clientes.rows) {
    if (c.loja_id !== null) porLojaId.set(c.loja_id, { id: c.id, nome: c.nome });
    porNome.set(normalizarSku(c.nome), { id: c.id, nome: c.nome });
  }

  const jaEntrou = new Map<string, number | null>();
  for (const i of importados.rows) {
    jaEntrou.set(`${i.order_id}|${i.item_id}`, i.pedido_id);
  }

  const porLoja = new Map<number, VendasDaLoja>();
  const semCadastro = new Map<
    string,
    { sku: string; titulo: string; unidades: number; lojas: Set<string> }
  >();

  for (const v of financeiro.vendas) {
    if (!v.sku) continue;
    // const própria porque o narrowing de v.sku não sobrevive aos callbacks
    const skuVenda = v.sku;
    const skuNorm = normalizarSku(skuVenda);

    let loja = porLoja.get(v.lojaId);
    if (!loja) {
      const cliente =
        porLojaId.get(v.lojaId) ?? porNome.get(normalizarSku(v.lojaNome)) ?? null;
      loja = {
        lojaId: v.lojaId,
        lojaNome: v.lojaNome,
        clienteId: cliente?.id ?? null,
        clienteNome: cliente?.nome ?? null,
        linhas: [],
        itens: 0,
        unidades: 0,
        total: 0,
        semCadastro: 0,
        jaImportados: 0,
      };
      porLoja.set(v.lojaId, loja);
    }

    const chave = `${v.orderId}|${v.itemId}`;
    const produto = porSku.get(skuNorm) ?? null;

    if (!produto) {
      const atual = semCadastro.get(skuNorm) ?? {
        sku: skuVenda,
        titulo: v.titulo,
        unidades: 0,
        lojas: new Set<string>(),
      };
      atual.unidades += v.quantidade;
      atual.lojas.add(v.lojaNome);
      semCadastro.set(skuNorm, atual);
      loja.semCadastro += v.quantidade;
    }

    // Agrupa por SKU: a loja pega várias vezes no mesmo dia, e o que interessa
    // pro pedido é o total do período, não cada retirada.
    const existente = loja.linhas.find((l) => normalizarSku(l.sku) === skuNorm);
    const importadoAqui = jaEntrou.has(chave);
    const preco = produto ? Number(produto.preco_venda) : 0;

    if (existente) {
      // linha já importada não soma junto com a nova: seriam dois estados no
      // mesmo número, e o Hudson não saberia o que confirmar
      if (existente.jaImportado === importadoAqui) {
        existente.quantidade += v.quantidade;
        existente.total = existente.quantidade * existente.precoUnitario;
      } else if (!importadoAqui) {
        loja.linhas.push({
          sku: skuVenda,
          titulo: v.titulo,
          quantidade: v.quantidade,
          produtoId: produto?.id ?? null,
          produtoNome: produto?.nome ?? null,
          precoUnitario: preco,
          total: v.quantidade * preco,
          jaImportado: false,
          pedidoId: null,
        });
      }
    } else {
      loja.linhas.push({
        sku: skuVenda,
        titulo: v.titulo,
        quantidade: v.quantidade,
        produtoId: produto?.id ?? null,
        produtoNome: produto?.nome ?? null,
        precoUnitario: preco,
        total: v.quantidade * preco,
        jaImportado: importadoAqui,
        pedidoId: importadoAqui ? jaEntrou.get(chave) ?? null : null,
      });
    }

    if (importadoAqui) loja.jaImportados += v.quantidade;
  }

  const lojas = [...porLoja.values()];
  for (const l of lojas) {
    l.linhas.sort((a, b) => b.total - a.total || a.sku.localeCompare(b.sku));
    l.itens = l.linhas.length;
    l.unidades = l.linhas.reduce((s, x) => s + x.quantidade, 0);
    l.total = l.linhas.reduce((s, x) => s + x.total, 0);
  }
  lojas.sort((a, b) => b.total - a.total);

  return {
    de,
    ate,
    lojas,
    semCadastro: [...semCadastro.values()]
      .map((s) => ({ sku: s.sku, titulo: s.titulo, unidades: s.unidades, lojas: [...s.lojas] }))
      .sort((a, b) => b.unidades - a.unidades),
    totalUnidades: lojas.reduce((s, l) => s + l.unidades, 0),
    totalValor: lojas.reduce((s, l) => s + l.total, 0),
  };
}
