import {
  extrairItemIdDaUrl,
  getItemFullComToken,
  getItemDescriptionComToken,
  getCategoryName,
  createItem,
  setItemDescription,
  ativarEnviosFlex,
  atualizarFotosDasVariacoes,
  requerModeloUserProduct,
  resolverItemIdPorUserProduct,
  listarFamiliaUserProducts,
  MlItemFull,
  MlAttribute,
  NovoItemPayload,
  IdentificadorAnuncio,
} from "./mercadoLivreItems";
import { listLojas } from "./tokenStore";

async function encontrarLojaDonaEItem(
  identificador: IdentificadorAnuncio,
  lojasPermitidas?: number[]
): Promise<{ lojaId: number; mlUserId: number; item: MlItemFull }> {
  const lojas = (await listLojas()).filter(
    (l) => l.ml_user_id !== null && (lojasPermitidas === undefined || lojasPermitidas.includes(l.id))
  );

  for (const loja of lojas) {
    const mlUserId = loja.ml_user_id as number;
    try {
      if (identificador.tipo === "user_product") {
        const itemId = await resolverItemIdPorUserProduct(loja.id, mlUserId, identificador.id);
        if (!itemId) continue;
        const item = await getItemFullComToken(loja.id, itemId);
        return { lojaId: loja.id, mlUserId, item };
      }
      const item = await getItemFullComToken(loja.id, identificador.id);
      return { lojaId: loja.id, mlUserId, item };
    } catch {
      // não é dessa loja, tenta a próxima
    }
  }

  throw new Error(
    "Esse anúncio não pertence a nenhuma das lojas às quais você tem acesso. O Mercado Livre só permite " +
      "ler os detalhes completos de um anúncio usando o token da própria conta dona dele, então só é " +
      "possível clonar anúncios que já são de uma das suas lojas."
  );
}

// Anúncios no modelo User Product não têm variações embutidas — cada "cor" é
// um anúncio (item) separado, todos ligados pelo mesmo family_id. Se o item
// pertence a uma família, busca todos os itens-irmãos pra clonar juntos.
async function buscarItensDaFamilia(lojaId: number, mlUserId: number, item: MlItemFull): Promise<MlItemFull[]> {
  if (!item.family_id) return [item];

  const irmaos = await listarFamiliaUserProducts(lojaId, item.site_id, item.family_id);
  const itens = await Promise.all(
    irmaos.map(async (userProductId) => {
      const itemId = await resolverItemIdPorUserProduct(lojaId, mlUserId, userProductId);
      if (!itemId) return null;
      try {
        return await getItemFullComToken(lojaId, itemId);
      } catch {
        return null;
      }
    })
  );
  const validos = itens.filter((i): i is MlItemFull => i !== null);
  return validos.length > 0 ? validos : [item];
}

function resumoVariacao(atributos: MlAttribute[]): string {
  return atributos.map((a) => `${a.name ?? a.id}: ${a.value_name ?? a.value_id ?? "-"}`).join(" · ");
}

function resumoItemDaFamilia(item: MlItemFull): string {
  const cor = item.attributes.find((a) => a.id === "COLOR" || a.name === "Cor");
  return cor ? `${cor.name ?? "Cor"}: ${cor.value_name ?? "-"}` : item.title;
}

export interface PreviewAnuncio {
  itemOriginalId: string;
  tituloOriginal: string;
  categoriaId: string;
  categoriaNome: string;
  preco: number;
  moeda: string;
  quantidadeDisponivel: number;
  condicao: string;
  siteId: string;
  fotos: string[];
  numAtributos: number;
  numVariacoes: number;
  variacoes: Array<{ index: number; resumo: string }>;
  frete: { modo: string; freteGratis: boolean; retiradaLocal: boolean };
  descricao: string;
  linkOriginal: string;
  lojaOrigemId: number;
}

export async function montarPreview(url: string, lojasPermitidas?: number[]): Promise<PreviewAnuncio> {
  const identificador = await extrairItemIdDaUrl(url);
  const { lojaId, mlUserId, item } = await encontrarLojaDonaEItem(identificador, lojasPermitidas);
  const itensFamilia = await buscarItensDaFamilia(lojaId, mlUserId, item);
  const temFamilia = itensFamilia.length > 1;

  const [descricao, categoriaNome] = await Promise.all([
    getItemDescriptionComToken(lojaId, item.id),
    getCategoryName(item.category_id),
  ]);

  return {
    itemOriginalId: item.id,
    tituloOriginal: item.title,
    categoriaId: item.category_id,
    categoriaNome,
    preco: item.price,
    moeda: item.currency_id,
    quantidadeDisponivel: item.available_quantity,
    condicao: item.condition,
    siteId: item.site_id,
    fotos: item.pictures.map((p) => p.secure_url),
    numAtributos: item.attributes.length,
    numVariacoes: temFamilia ? itensFamilia.length : item.variations?.length ?? 0,
    variacoes: temFamilia
      ? itensFamilia.map((it, index) => ({ index, resumo: resumoItemDaFamilia(it) }))
      : (item.variations ?? []).map((v, index) => ({ index, resumo: resumoVariacao(v.attribute_combinations) })),
    frete: {
      modo: item.shipping.mode,
      freteGratis: item.shipping.free_shipping,
      retiradaLocal: item.shipping.local_pick_up,
    },
    descricao,
    linkOriginal: item.permalink,
    lojaOrigemId: lojaId,
  };
}

export interface OpcoesClone {
  titulos: string[];
  listingType: string;
  ativarFlex: boolean;
  imagensPersonalizadas?: string[];
  imagensPorVariacao?: Record<number, string[]>;
}

export interface ResultadoClone {
  novoItemId: string;
  permalink: string;
}

async function publicarUmaCopia(
  original: MlItemFull,
  descricao: string,
  lojaDestinoId: number,
  titulo: string,
  opcoes: OpcoesClone
): Promise<ResultadoClone> {
  const temVariacoes = original.variations && original.variations.length > 0;
  const usaFotosPorVariacao = temVariacoes && opcoes.imagensPorVariacao && Object.keys(opcoes.imagensPorVariacao).length > 0;

  let fotosGerais: string[];
  const faixaPorVariacao: number[][] = [];

  if (usaFotosPorVariacao) {
    // fotos gerais do item = a primeira foto de cada variação (capa), e o restante fica só na variação
    const combinadas: string[] = [];
    original.variations.forEach((_, index) => {
      const fotosDaVariacao = opcoes.imagensPorVariacao?.[index]?.length
        ? opcoes.imagensPorVariacao[index]
        : original.pictures.map((p) => p.secure_url);
      const inicio = combinadas.length;
      combinadas.push(...fotosDaVariacao);
      faixaPorVariacao.push(Array.from({ length: fotosDaVariacao.length }, (_, i) => inicio + i));
    });
    fotosGerais = combinadas;
  } else {
    fotosGerais = opcoes.imagensPersonalizadas?.length
      ? opcoes.imagensPersonalizadas
      : original.pictures.map((p) => p.secure_url);
  }

  const payload: NovoItemPayload = {
    title: titulo,
    category_id: original.category_id,
    price: original.price,
    currency_id: original.currency_id,
    available_quantity: original.available_quantity,
    buying_mode: original.buying_mode,
    condition: original.condition,
    listing_type_id: opcoes.listingType,
    pictures: fotosGerais.map((source) => ({ source })),
    attributes: original.attributes,
    shipping: {
      mode: original.shipping.mode,
      local_pick_up: original.shipping.local_pick_up,
      free_shipping: original.shipping.free_shipping,
    },
  };

  if (temVariacoes) {
    payload.variations = original.variations.map((v) => ({
      attribute_combinations: v.attribute_combinations,
      price: v.price,
      available_quantity: v.available_quantity,
    }));
  }

  let novoItem: MlItemFull;
  try {
    novoItem = await createItem(lojaDestinoId, payload);
  } catch (err) {
    if (!requerModeloUserProduct(err)) {
      throw err;
    }
    // Algumas categorias já migraram pro modelo "User Product". Quando o
    // anúncio tem variações, cada uma vira um anúncio independente ligado
    // pelo mesmo family_name (ver publicarFamiliaDeItens). Quando não tem
    // variações, o próprio Mercado Livre ainda assim exige o campo
    // family_name nesse tipo de categoria — só precisa tentar de novo com
    // esse campo preenchido, sem precisar quebrar em vários anúncios.
    if (temVariacoes) {
      const fontes: FonteFamiliaItem[] = original.variations.map((v, index) => ({
        price: v.price,
        available_quantity: v.available_quantity,
        category_id: original.category_id,
        currency_id: original.currency_id,
        buying_mode: original.buying_mode,
        condition: original.condition,
        attributes: [...original.attributes, ...v.attribute_combinations],
        pictures: opcoes.imagensPorVariacao?.[index]?.length
          ? opcoes.imagensPorVariacao[index]
          : opcoes.imagensPersonalizadas?.length
          ? opcoes.imagensPersonalizadas
          : original.pictures.map((p) => p.secure_url),
        siteId: original.site_id,
        shipping: original.shipping,
      }));
      return publicarFamiliaDeItens(fontes, descricao, lojaDestinoId, titulo, opcoes);
    }
    const { title: _titulo, ...payloadSemTitulo } = payload;
    novoItem = await createItem(lojaDestinoId, { ...payloadSemTitulo, family_name: titulo.slice(0, 120) });
  }

  if (descricao) {
    await setItemDescription(lojaDestinoId, novoItem.id, descricao);
  }

  if (opcoes.ativarFlex) {
    await ativarEnviosFlex(lojaDestinoId, original.site_id, novoItem.id);
  }

  if (usaFotosPorVariacao && novoItem.variations && novoItem.variations.length === faixaPorVariacao.length) {
    const idsDasFotosNovas = novoItem.pictures.map((p) => p.id);
    const variacoesComFotos = novoItem.variations.map((v, index) => ({
      id: v.id,
      picture_ids: faixaPorVariacao[index].map((i) => idsDasFotosNovas[i]).filter(Boolean),
    }));
    await atualizarFotosDasVariacoes(lojaDestinoId, novoItem.id, variacoesComFotos);
  }

  return { novoItemId: novoItem.id, permalink: novoItem.permalink };
}

interface FonteFamiliaItem {
  price: number;
  available_quantity: number;
  category_id: string;
  currency_id: string;
  buying_mode: string;
  condition: string;
  attributes: MlAttribute[];
  pictures: string[];
  siteId: string;
  shipping: { mode: string; local_pick_up: boolean; free_shipping: boolean };
}

// Cria um anúncio independente por "fonte" (uma cor/variação cada), todos com
// o mesmo family_name — o Mercado Livre os agrupa automaticamente numa mesma
// família na página do produto. Usado tanto para anúncios clássicos com
// variações que precisaram cair no modelo User Product, quanto para links que
// já apontam direto pra uma família (várias cores já publicadas separadas).
// Roda em série (não em paralelo) para, se algo falhar no meio, sabermos
// exatamente quantos anúncios já foram criados.
async function publicarFamiliaDeItens(
  fontes: FonteFamiliaItem[],
  descricao: string,
  lojaDestinoId: number,
  titulo: string,
  opcoes: OpcoesClone
): Promise<ResultadoClone> {
  const familyName = titulo.slice(0, 120);
  let primeiroItem: ResultadoClone | null = null;
  const criados: string[] = [];

  try {
    for (const [index, fonte] of fontes.entries()) {
      const fotos = opcoes.imagensPorVariacao?.[index]?.length ? opcoes.imagensPorVariacao[index] : fonte.pictures;

      const payloadItem: NovoItemPayload = {
        // Sem "title": no modelo User Product ele é gerado automaticamente
        // a partir do family_name + atributos.
        category_id: fonte.category_id,
        price: fonte.price,
        currency_id: fonte.currency_id,
        available_quantity: fonte.available_quantity,
        buying_mode: fonte.buying_mode,
        condition: fonte.condition,
        listing_type_id: opcoes.listingType,
        pictures: fotos.map((source) => ({ source })),
        attributes: fonte.attributes,
        family_name: familyName,
        shipping: fonte.shipping,
      };

      const novoItem = await createItem(lojaDestinoId, payloadItem);
      criados.push(novoItem.id);

      if (descricao) {
        await setItemDescription(lojaDestinoId, novoItem.id, descricao);
      }
      if (opcoes.ativarFlex) {
        await ativarEnviosFlex(lojaDestinoId, fonte.siteId, novoItem.id);
      }

      if (!primeiroItem) {
        primeiroItem = { novoItemId: novoItem.id, permalink: novoItem.permalink };
      }
    }
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : "erro desconhecido";
    throw new Error(
      `Falha ao criar a família de anúncios (modelo User Product): ${criados.length} de ` +
        `${fontes.length} anúncios foram criados antes do erro (ids: ${criados.join(", ") || "nenhum"}). ` +
        `Confira/apague manualmente no Mercado Livre se necessário. Erro: ${mensagem}`
    );
  }

  return primeiroItem!;
}

export async function publicarClone(
  url: string,
  lojaDestinoId: number,
  opcoes: OpcoesClone,
  lojasPermitidas?: number[]
): Promise<ResultadoClone[]> {
  const identificador = await extrairItemIdDaUrl(url);
  const { lojaId: lojaOrigemId, mlUserId, item: original } = await encontrarLojaDonaEItem(
    identificador,
    lojasPermitidas
  );
  const itensFamilia = await buscarItensDaFamilia(lojaOrigemId, mlUserId, original);
  const descricao = await getItemDescriptionComToken(lojaOrigemId, original.id);

  const titulos = opcoes.titulos.slice(0, 20);
  const resultados: ResultadoClone[] = [];

  for (const titulo of titulos) {
    if (itensFamilia.length > 1) {
      const fontes: FonteFamiliaItem[] = itensFamilia.map((it, index) => ({
        price: it.price,
        available_quantity: it.available_quantity,
        category_id: it.category_id,
        currency_id: it.currency_id,
        buying_mode: it.buying_mode,
        condition: it.condition,
        attributes: it.attributes,
        pictures: opcoes.imagensPorVariacao?.[index]?.length
          ? opcoes.imagensPorVariacao[index]
          : it.pictures.map((p) => p.secure_url),
        siteId: it.site_id,
        shipping: it.shipping,
      }));
      resultados.push(await publicarFamiliaDeItens(fontes, descricao, lojaDestinoId, titulo, opcoes));
    } else {
      resultados.push(await publicarUmaCopia(original, descricao, lojaDestinoId, titulo, opcoes));
    }
  }

  return resultados;
}
