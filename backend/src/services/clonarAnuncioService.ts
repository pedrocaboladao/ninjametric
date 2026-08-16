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
  requerRemoverGtin,
  atributoObrigatorioFaltando,
  atributoRejeitado,
  definirSkuDoItem,
  definirSkusDasVariacoes,
  extrairSkuDoItem,
  resolverItemIdPorUserProduct,
  listarFamiliaUserProducts,
  MlItemFull,
  MlAttribute,
  MlVariation,
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

// Atributos que já confirmamos com o dono das lojas — não são um "chute",
// é o valor real desses produtos (impermeabilizantes/tintas à base de água,
// não inflamáveis). Se algum dia um anúncio realmente inflamável cair aqui,
// o correto é ajustar isso, não confiar cegamente no valor padrão.
const VALOR_PADRAO_CONFIRMADO: Record<string, { value_id: string; value_name: string }> = {
  IS_FLAMMABLE: { value_id: "242084", value_name: "Não" },
};

// Peso/dimensões da embalagem ("cubagem"). Testamos remover isso por padrão
// achando que reduzia o frete calculado, mas na prática é o oposto: sem
// cubagem declarada, o Mercado Livre assume um pacote genérico bem maior/
// mais pesado pra calcular o frete, e o clone sai com frete várias vezes
// mais caro que o original (confirmado comparando frete real dos dois pro
// mesmo CEP). Por isso agora mantemos a cubagem real do anúncio original
// por padrão — só removemos reativamente se a categoria de destino
// realmente rejeitar esse atributo (ver atributoRejeitado).
const ATRIBUTOS_CUBAGEM = ["SELLER_PACKAGE_WEIGHT", "SELLER_PACKAGE_HEIGHT", "SELLER_PACKAGE_WIDTH", "SELLER_PACKAGE_LENGTH"];

// O GET /items/{id} traz nos atributos campos extras que só existem em
// resposta de leitura (values, struct, value_type, attribute_group_id...).
// Reenviar isso na criação (POST /items) pode fazer a API do Mercado Livre
// travar num erro interno genérico (500 "internal_error", cause vazio, sem
// pista nenhuma) em vez de uma validação normal — por isso sempre reduz pro
// formato mínimo que a criação espera antes de mandar.
function sanearAtributos(atributos: MlAttribute[]): MlAttribute[] {
  return atributos.map((a) => {
    const limpo: MlAttribute = { id: a.id };
    if (a.value_id !== undefined && a.value_id !== null) limpo.value_id = a.value_id;
    if (a.value_name !== undefined && a.value_name !== null) limpo.value_name = a.value_name;
    return limpo;
  });
}

// Dígito verificador padrão EAN-13/GTIN-13 (GS1 General Specifications).
function calcularDigitoVerificadorEan13(doze: string): number {
  let soma = 0;
  for (let i = 0; i < 12; i++) {
    soma += Number(doze[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const resto = soma % 10;
  return resto === 0 ? 0 : 10 - resto;
}

// Gera um GTIN-13 válido (dígito verificador correto) dentro da faixa que a
// própria GS1 reserva pra uso interno/restrito de empresas (prefixo "02...",
// nunca atribuída a produto real de ninguém) — evita colidir com o código
// de barras de outra empresa. Determinístico a partir de uma chave (SKU/
// título do produto), pra não gerar o mesmo código pra produtos diferentes.
function gerarGtinInterno(chave: string): string {
  let hash = 0;
  for (let i = 0; i < chave.length; i++) {
    hash = (hash * 31 + chave.charCodeAt(i)) >>> 0;
  }
  const dezDigitos = String(hash).padStart(10, "0").slice(-10);
  const doze = `02${dezDigitos}`;
  return doze + calcularDigitoVerificadorEan13(doze);
}

// Anúncios antigos/categorias diferentes têm exigências diferentes: algumas
// recusam reaproveitar o GTIN do original (já usado em outro anúncio),
// outras exigem atributos que o anúncio antigo nunca teve (ex.: declaração
// de inflamabilidade), outras exigem cubagem que preferimos omitir por
// padrão. Tenta criar normal (sem cubagem) e só ajusta o payload
// reativamente pros erros conhecidos, usando os valores reais do anúncio
// original quando existem — nunca inventando peso/dimensão.
async function criarItemComFallbacks(
  lojaId: number,
  payloadOriginal: NovoItemPayload,
  atributosOriginaisCompletosBrutos: MlAttribute[]
): Promise<MlItemFull> {
  const atributosOriginaisCompletos = sanearAtributos(atributosOriginaisCompletosBrutos);
  const payloadInicial: NovoItemPayload = {
    ...payloadOriginal,
    attributes: sanearAtributos(payloadOriginal.attributes),
    variations: payloadOriginal.variations?.map((v) => ({
      ...v,
      attribute_combinations: sanearAtributos(v.attribute_combinations),
    })),
  };

  try {
    return await createItem(lojaId, payloadInicial);
  } catch (err) {
    let payload = payloadInicial;
    let ajustou = false;

    if (requerRemoverGtin(err)) {
      payload = { ...payload, attributes: payload.attributes.filter((a) => a.id !== "GTIN") };
      ajustou = true;
    }

    for (const [attributeId, valor] of Object.entries(VALOR_PADRAO_CONFIRMADO)) {
      if (atributoObrigatorioFaltando(err, attributeId)) {
        payload = { ...payload, attributes: [...payload.attributes, { id: attributeId, ...valor }] };
        ajustou = true;
      }
    }

    // Categoria de destino usa "Formato de venda" = Unidade, e por isso o
    // Mercado Livre passa a exigir "Unidades por kit" (UNITS_PER_PACK) —
    // como não é venda em kit (é unidade avulsa), o valor correto é 1,
    // exatamente o que o próprio erro do Mercado Livre sugere.
    if (atributoObrigatorioFaltando(err, "UNITS_PER_PACK")) {
      payload = { ...payload, attributes: [...payload.attributes, { id: "UNITS_PER_PACK", value_name: "1" }] };
      ajustou = true;
    }

    for (const attributeId of ATRIBUTOS_CUBAGEM) {
      if (!atributoObrigatorioFaltando(err, attributeId)) continue;
      const valorOriginal = atributosOriginaisCompletos.find((a) => a.id === attributeId);
      if (!valorOriginal) {
        throw new Error(
          `A categoria de destino exige o atributo "${attributeId}" (cubagem), mas o anúncio original não tinha ` +
            `esse valor declarado — não dá pra inventar um peso/dimensão. Declare manualmente no Mercado Livre ` +
            `depois de criado, ou me diga o valor certo pra eu incluir.`
        );
      }
      payload = { ...payload, attributes: [...payload.attributes, valorOriginal] };
      ajustou = true;
    }

    // Caso oposto: a categoria de destino rejeita a cubagem que enviamos por
    // padrão (não é toda categoria que exige, e algumas nem aceitam).
    for (const attributeId of ATRIBUTOS_CUBAGEM) {
      if (!atributoRejeitado(err, attributeId)) continue;
      if (!payload.attributes.some((a) => a.id === attributeId)) continue;
      payload = { ...payload, attributes: payload.attributes.filter((a) => a.id !== attributeId) };
      ajustou = true;
    }

    // GTIN obrigatório e faltando: se o original tinha um GTIN real,
    // reaproveita. Se não tinha, gera um GTIN-13 válido dentro da faixa
    // reservada da GS1 pra uso interno (nunca atribuída a produto real de
    // ninguém) — decisão explícita do dono das lojas, ciente do risco.
    if (atributoObrigatorioFaltando(err, "GTIN")) {
      const gtinOriginal = atributosOriginaisCompletos.find((a) => a.id === "GTIN");
      if (gtinOriginal) {
        payload = { ...payload, attributes: [...payload.attributes, gtinOriginal] };
      } else {
        // Inclui loja + título/família na chave pra não gerar o mesmo GTIN
        // ao clonar o mesmo produto em lojas diferentes ou em várias cópias.
        const sku = atributosOriginaisCompletos.find((a) => a.id === "SELLER_SKU")?.value_name ?? "";
        const chave = `${lojaId}|${sku}|${payload.title ?? payload.family_name ?? payload.category_id}`;
        const gtinGerado = gerarGtinInterno(chave);
        payload = {
          ...payload,
          attributes: [...payload.attributes.filter((a) => a.id !== "GTIN"), { id: "GTIN", value_name: gtinGerado }],
        };
      }
      ajustou = true;
    }

    if (!ajustou) throw err;
    return createItem(lojaId, payload);
  }
}

// Confere se o SKU do anúncio original realmente colou no clone e, se não
// colou, grava explicitamente. O POST /items aceita seller_custom_field mas
// nem sempre persiste (varia por categoria/modelo de anúncio) — e é esse
// campo que o resto do sistema usa como SKU de verdade (Financeiro,
// Produtos, Precificação, agentes). Melhor esforço: se nem o PUT gravar, o
// anúncio continua publicado, só avisa.
async function garantirSku(
  lojaDestinoId: number,
  origem: { seller_custom_field?: string | null; attributes?: MlAttribute[]; variations?: MlVariation[] },
  novoItem: MlItemFull,
  avisos: string[]
): Promise<void> {
  const sku = extrairSkuDoItem(origem);
  if (sku && novoItem.seller_custom_field !== sku) {
    try {
      await definirSkuDoItem(lojaDestinoId, novoItem.id, sku);
    } catch (err) {
      avisos.push(
        `Não conseguiu gravar o SKU "${sku}" em ${novoItem.id}: ${err instanceof Error ? err.message : "erro desconhecido"}`
      );
    }
  }

  // Em anúncio com variações o SKU que aparece na tela do Mercado Livre é o
  // de CADA variação, não o do anúncio. Os ids das variações do clone são
  // novos (diferentes dos do original), mas a ordem é a mesma em que foram
  // enviadas na criação — por isso casa por posição, mesmo critério já usado
  // pra vincular as fotos das variações.
  const variacoesOrigem = origem.variations ?? [];
  const variacoesNovas = novoItem.variations ?? [];
  if (variacoesOrigem.length === 0 || variacoesNovas.length !== variacoesOrigem.length) return;

  const skusDasVariacoes = variacoesNovas
    .map((nova, indice) => ({ id: nova.id, seller_custom_field: variacoesOrigem[indice].seller_custom_field ?? "" }))
    .filter((v) => v.seller_custom_field !== "");
  if (skusDasVariacoes.length === 0) return;

  try {
    await definirSkusDasVariacoes(lojaDestinoId, novoItem.id, skusDasVariacoes);
  } catch (err) {
    avisos.push(
      `Não conseguiu gravar o SKU das variações em ${novoItem.id}: ${err instanceof Error ? err.message : "erro desconhecido"}`
    );
  }
}

function resumoVariacao(atributos: MlAttribute[]): string {
  return atributos.map((a) => `${a.name ?? a.id}: ${a.value_name ?? a.value_id ?? "-"}`).join(" · ");
}

function resumoItemDaFamilia(item: MlItemFull): string {
  const cor = item.attributes.find((a) => a.id === "COLOR" || a.name === "Cor");
  return cor ? `${cor.name ?? "Cor"}: ${cor.value_name ?? "-"}` : item.title;
}

// O Mercado Livre limita a 12 fotos por anúncio.
const MAX_FOTOS = 12;

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
  avisos?: string[];
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
    fotosGerais = combinadas.slice(0, MAX_FOTOS);
  } else {
    fotosGerais = (opcoes.imagensPersonalizadas?.length
      ? opcoes.imagensPersonalizadas
      : original.pictures.map((p) => p.secure_url)
    ).slice(0, MAX_FOTOS);
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
    seller_custom_field: extrairSkuDoItem(original),
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
      seller_custom_field: v.seller_custom_field || undefined,
    }));
  }

  let novoItem: MlItemFull;
  try {
    novoItem = await criarItemComFallbacks(lojaDestinoId, payload, original.attributes);
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
        pictures: (opcoes.imagensPorVariacao?.[index]?.length
          ? opcoes.imagensPorVariacao[index]
          : opcoes.imagensPersonalizadas?.length
          ? opcoes.imagensPersonalizadas
          : original.pictures.map((p) => p.secure_url)
        ).slice(0, MAX_FOTOS),
        siteId: original.site_id,
        shipping: original.shipping,
        sellerCustomField: v.seller_custom_field || undefined,
      }));
      return publicarFamiliaDeItens(fontes, descricao, lojaDestinoId, titulo, opcoes);
    }
    const { title: _titulo, ...payloadSemTitulo } = payload;
    novoItem = await criarItemComFallbacks(
      lojaDestinoId,
      { ...payloadSemTitulo, family_name: titulo.slice(0, 120) },
      original.attributes
    );
  }

  if (descricao) {
    await setItemDescription(lojaDestinoId, novoItem.id, descricao);
  }

  const avisos: string[] = [];

  if (opcoes.ativarFlex) {
    // Melhor esforço: se o flex não ativar (já vimos bloqueios pontuais do
    // próprio Mercado Livre nesse endpoint), o anúncio continua válido e
    // publicado — só avisamos, sem derrubar o clone inteiro por causa disso.
    try {
      await ativarEnviosFlex(lojaDestinoId, original.site_id, novoItem.id);
    } catch (err) {
      avisos.push(
        `Não conseguiu ativar envios flex em ${novoItem.id}: ${err instanceof Error ? err.message : "erro desconhecido"}`
      );
    }
  }

  if (usaFotosPorVariacao && novoItem.variations && novoItem.variations.length === faixaPorVariacao.length) {
    const idsDasFotosNovas = novoItem.pictures.map((p) => p.id);
    const variacoesComFotos = novoItem.variations.map((v, index) => ({
      id: v.id,
      picture_ids: faixaPorVariacao[index].map((i) => idsDasFotosNovas[i]).filter(Boolean),
    }));
    await atualizarFotosDasVariacoes(lojaDestinoId, novoItem.id, variacoesComFotos);
  }

  // Por último de propósito: gravar o SKU das variações é um PUT no mesmo
  // campo "variations" que a vinculação de fotos acima — se rodasse antes,
  // o PUT das fotos poderia sobrescrever o SKU recém-gravado.
  await garantirSku(lojaDestinoId, original, novoItem, avisos);

  return { novoItemId: novoItem.id, permalink: novoItem.permalink, avisos: avisos.length ? avisos : undefined };
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
  sellerCustomField?: string | null;
}

type ResultadoTarefa<R> = { sucesso: true; valor: R } | { sucesso: false; erro: unknown };

// Roda até `limite` tarefas em paralelo (em vez de uma por vez), preservando
// o resultado (ou erro) de cada item individualmente. Famílias grandes (12+
// anúncios) rodando em série demoravam o suficiente pra estourar o timeout
// do proxy (erro 504) — em paralelo, o tempo total cai proporcionalmente.
async function comConcorrenciaLimitada<T, R>(
  itens: T[],
  limite: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<ResultadoTarefa<R>[]> {
  const resultados: ResultadoTarefa<R>[] = new Array(itens.length);
  let proximo = 0;
  async function worker() {
    while (proximo < itens.length) {
      const i = proximo++;
      try {
        resultados[i] = { sucesso: true, valor: await fn(itens[i], i) };
      } catch (erro) {
        resultados[i] = { sucesso: false, erro };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, worker));
  return resultados;
}

const CONCORRENCIA_FAMILIA = 4;

// Cria um anúncio independente por "fonte" (uma cor/variação cada), todos com
// o mesmo family_name — o Mercado Livre os agrupa automaticamente numa mesma
// família na página do produto. Usado tanto para anúncios clássicos com
// variações que precisaram cair no modelo User Product, quanto para links que
// já apontam direto pra uma família (várias cores já publicadas separadas).
// Roda com um pouco de paralelismo (não um de cada vez) pra famílias grandes
// não demorarem tanto a ponto de estourar o timeout do proxy.
async function publicarFamiliaDeItens(
  fontes: FonteFamiliaItem[],
  descricao: string,
  lojaDestinoId: number,
  titulo: string,
  opcoes: OpcoesClone
): Promise<ResultadoClone> {
  const familyName = titulo.slice(0, 120);
  const avisos: string[] = [];

  const resultados = await comConcorrenciaLimitada(fontes, CONCORRENCIA_FAMILIA, async (fonte, index) => {
    const fotos = (opcoes.imagensPorVariacao?.[index]?.length ? opcoes.imagensPorVariacao[index] : fonte.pictures).slice(
      0,
      MAX_FOTOS
    );

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
      seller_custom_field: fonte.sellerCustomField,
      family_name: familyName,
      shipping: fonte.shipping,
    };

    const novoItem = await criarItemComFallbacks(lojaDestinoId, payloadItem, fonte.attributes);

    if (descricao) {
      await setItemDescription(lojaDestinoId, novoItem.id, descricao);
    }

    await garantirSku(
      lojaDestinoId,
      { seller_custom_field: fonte.sellerCustomField, attributes: fonte.attributes },
      novoItem,
      avisos
    );

    if (opcoes.ativarFlex) {
      // Melhor esforço: um bloqueio pontual do Mercado Livre nesse endpoint
      // não deve travar a criação do restante da família.
      try {
        await ativarEnviosFlex(lojaDestinoId, fonte.siteId, novoItem.id);
      } catch (err) {
        avisos.push(
          `Não conseguiu ativar envios flex em ${novoItem.id}: ${err instanceof Error ? err.message : "erro desconhecido"}`
        );
      }
    }

    return { novoItemId: novoItem.id, permalink: novoItem.permalink };
  });

  const sucessos = resultados.filter((r): r is { sucesso: true; valor: ResultadoClone } => r.sucesso);
  const falhas = resultados.filter((r): r is { sucesso: false; erro: unknown } => !r.sucesso);

  if (sucessos.length === 0) {
    const primeiraFalha = falhas[0]?.erro;
    const mensagem = primeiraFalha instanceof Error ? primeiraFalha.message : "erro desconhecido";
    throw new Error(`Falha ao criar a família de anúncios (modelo User Product): nenhum anúncio foi criado. Erro: ${mensagem}`);
  }

  if (falhas.length > 0) {
    avisos.push(
      `${falhas.length} de ${fontes.length} anúncios da família não foram criados (os outros ${sucessos.length} foram publicados normalmente).`
    );
  }

  return { ...sucessos[0].valor, avisos: avisos.length ? avisos : undefined };
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
        pictures: (opcoes.imagensPorVariacao?.[index]?.length
          ? opcoes.imagensPorVariacao[index]
          : it.pictures.map((p) => p.secure_url)
        ).slice(0, MAX_FOTOS),
        siteId: it.site_id,
        shipping: it.shipping,
        sellerCustomField: it.seller_custom_field || undefined,
      }));
      resultados.push(await publicarFamiliaDeItens(fontes, descricao, lojaDestinoId, titulo, opcoes));
    } else {
      resultados.push(await publicarUmaCopia(original, descricao, lojaDestinoId, titulo, opcoes));
    }
  }

  return resultados;
}
