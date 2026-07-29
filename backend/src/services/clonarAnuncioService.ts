import {
  extrairItemIdDaUrl,
  getItemFullComToken,
  getItemDescriptionComToken,
  getCategoryName,
  createItem,
  setItemDescription,
  ativarEnviosFlex,
  atualizarFotosDasVariacoes,
  MlItemFull,
  NovoItemPayload,
} from "./mercadoLivreItems";
import { listLojas } from "./tokenStore";

async function encontrarLojaDonaEItem(itemId: string): Promise<{ lojaId: number; item: MlItemFull }> {
  const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null);

  for (const loja of lojas) {
    try {
      const item = await getItemFullComToken(loja.id, itemId);
      return { lojaId: loja.id, item };
    } catch {
      // não é dessa loja, tenta a próxima
    }
  }

  throw new Error(
    "Esse anúncio não pertence a nenhuma das suas 4 lojas cadastradas. O Mercado Livre só permite " +
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

export async function montarPreview(url: string): Promise<PreviewAnuncio> {
  const itemId = await extrairItemIdDaUrl(url);
  const { lojaId, item } = await encontrarLojaDonaEItem(itemId);
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
  tituloFinal: string;
  listingType: string;
  ativarFlex: boolean;
  quantidadeClones: number;
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
    title: opcoes.tituloFinal,
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

  const novoItem = await createItem(lojaDestinoId, payload);

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

export async function publicarClone(
  url: string,
  lojaDestinoId: number,
  opcoes: OpcoesClone
): Promise<ResultadoClone[]> {
  const itemId = await extrairItemIdDaUrl(url);
  const { lojaId: lojaOrigemId, item: original } = await encontrarLojaDonaEItem(itemId);
  const descricao = await getItemDescriptionComToken(lojaOrigemId, itemId);

  const quantidade = Math.max(1, Math.min(20, opcoes.quantidadeClones || 1));
  const resultados: ResultadoClone[] = [];
  for (let i = 0; i < quantidade; i++) {
    resultados.push(await publicarUmaCopia(original, descricao, lojaDestinoId, opcoes));
  }
  return resultados;
}
