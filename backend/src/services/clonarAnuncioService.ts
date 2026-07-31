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
  MlItemFull,
  NovoItemPayload,
} from "./mercadoLivreItems";
import { listLojas } from "./tokenStore";

async function encontrarLojaDonaEItem(
  itemId: string,
  lojasPermitidas?: number[]
): Promise<{ lojaId: number; item: MlItemFull }> {
  const lojas = (await listLojas()).filter(
    (l) => l.ml_user_id !== null && (lojasPermitidas === undefined || lojasPermitidas.includes(l.id))
  );

  for (const loja of lojas) {
    try {
      const item = await getItemFullComToken(loja.id, itemId);
      return { lojaId: loja.id, item };
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

function resumoVariacao(atributos: MlItemFull["variations"][number]["attribute_combinations"]): string {
  return atributos.map((a) => `${a.name ?? a.id}: ${a.value_name ?? a.value_id ?? "-"}`).join(" · ");
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
  const itemId = await extrairItemIdDaUrl(url);
  const { lojaId, item } = await encontrarLojaDonaEItem(itemId, lojasPermitidas);
  const [descricao, categoriaNome] = await Promise.all([
    getItemDescriptionComToken(lojaId, itemId),
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
    numVariacoes: item.variations?.length ?? 0,
    variacoes: (item.variations ?? []).map((v, index) => ({ index, resumo: resumoVariacao(v.attribute_combinations) })),
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
    // pelo mesmo family_name (ver publicarComoFamiliaUserProduct). Quando
    // não tem variações, o próprio Mercado Livre ainda assim exige o campo
    // family_name nesse tipo de categoria — só precisa tentar de novo com
    // esse campo preenchido, sem precisar quebrar em vários anúncios.
    if (temVariacoes) {
      return publicarComoFamiliaUserProduct(original, descricao, lojaDestinoId, titulo, opcoes);
    }
    novoItem = await createItem(lojaDestinoId, { ...payload, family_name: titulo.slice(0, 120) });
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

// Fallback para categorias no modelo "User Product": em vez de um item só com
// várias variações dentro, cria um anúncio independente por variação (ex.:
// uma cor cada), todos com o mesmo family_name — o Mercado Livre os agrupa
// automaticamente numa mesma "família" na página do produto. Roda em série
// (não em paralelo) para, se algo falhar no meio, sabermos exatamente quantas
// variações já foram criadas.
async function publicarComoFamiliaUserProduct(
  original: MlItemFull,
  descricao: string,
  lojaDestinoId: number,
  titulo: string,
  opcoes: OpcoesClone
): Promise<ResultadoClone> {
  const familyName = titulo.slice(0, 120);
  let primeiroItem: ResultadoClone | null = null;
  const criados: string[] = [];

  try {
    for (const [index, variacao] of original.variations.entries()) {
      const fotosDaVariacao = opcoes.imagensPorVariacao?.[index]?.length
        ? opcoes.imagensPorVariacao[index]
        : opcoes.imagensPersonalizadas?.length
        ? opcoes.imagensPersonalizadas
        : original.pictures.map((p) => p.secure_url);

      const payloadItem: NovoItemPayload = {
        title: titulo,
        category_id: original.category_id,
        price: variacao.price,
        currency_id: original.currency_id,
        available_quantity: variacao.available_quantity,
        buying_mode: original.buying_mode,
        condition: original.condition,
        listing_type_id: opcoes.listingType,
        pictures: fotosDaVariacao.map((source) => ({ source })),
        attributes: [...original.attributes, ...variacao.attribute_combinations],
        family_name: familyName,
        shipping: {
          mode: original.shipping.mode,
          local_pick_up: original.shipping.local_pick_up,
          free_shipping: original.shipping.free_shipping,
        },
      };

      const novoItem = await createItem(lojaDestinoId, payloadItem);
      criados.push(novoItem.id);

      if (descricao) {
        await setItemDescription(lojaDestinoId, novoItem.id, descricao);
      }
      if (opcoes.ativarFlex) {
        await ativarEnviosFlex(lojaDestinoId, original.site_id, novoItem.id);
      }

      if (!primeiroItem) {
        primeiroItem = { novoItemId: novoItem.id, permalink: novoItem.permalink };
      }
    }
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : "erro desconhecido";
    throw new Error(
      `Falha ao criar a família de variações (modelo User Product): ${criados.length} de ` +
        `${original.variations.length} anúncios foram criados antes do erro (ids: ${criados.join(", ") || "nenhum"}). ` +
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
  const itemId = await extrairItemIdDaUrl(url);
  const { lojaId: lojaOrigemId, item: original } = await encontrarLojaDonaEItem(itemId, lojasPermitidas);
  const descricao = await getItemDescriptionComToken(lojaOrigemId, itemId);

  const titulos = opcoes.titulos.slice(0, 20);
  const resultados: ResultadoClone[] = [];
  for (const titulo of titulos) {
    resultados.push(await publicarUmaCopia(original, descricao, lojaDestinoId, titulo, opcoes));
  }
  return resultados;
}
