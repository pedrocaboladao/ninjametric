import {
  extrairItemIdDaUrl,
  getItemFullComToken,
  getItemDescriptionComToken,
  resolverItemIdPorUserProduct,
  type MlItemFull,
  type IdentificadorAnuncio,
} from "./mercadoLivreItems";
import { listLojas } from "./tokenStore";

// Igual ao "encontrarLojaDonaEItem" de clonarAnuncioService.ts (não
// exportado de lá, então reimplementado aqui do zero pra não arriscar
// mexer naquele módulo já testado) — o Mercado Livre só deixa ler detalhes
// completos de um anúncio com o token da própria conta dona dele, então
// tenta o token de cada loja cadastrada até achar a dona.
async function encontrarItemComLoja(identificador: IdentificadorAnuncio): Promise<{ lojaId: number; item: MlItemFull }> {
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

  throw new Error(
    "Esse anúncio não pertence a nenhuma das suas lojas cadastradas — só dá pra puxar dados de anúncios que já são seus."
  );
}

async function baixarImagemComoBase64(url: string): Promise<string | null> {
  try {
    const resposta = await fetch(url);
    if (!resposta.ok) return null;
    const buffer = Buffer.from(await resposta.arrayBuffer());
    return buffer.toString("base64");
  } catch {
    return null;
  }
}

export interface DadosAnuncioParaKit {
  titulo: string;
  descricao: string;
  atributos: string[];
  fotoBase64: string | null;
}

// Puxa título, descrição, ficha técnica e a foto principal de um anúncio já
// existente (de uma das lojas cadastradas), pra pré-preencher o Kit de
// Fotos sem precisar digitar tudo de novo.
export async function buscarDadosAnuncio(url: string): Promise<DadosAnuncioParaKit> {
  const identificador = await extrairItemIdDaUrl(url);
  const { lojaId, item } = await encontrarItemComLoja(identificador);

  const [descricao, fotoBase64] = await Promise.all([
    getItemDescriptionComToken(lojaId, item.id),
    item.pictures[0] ? baixarImagemComoBase64(item.pictures[0].secure_url) : Promise.resolve(null),
  ]);

  const atributos = item.attributes
    .map((a) => `${a.name ?? a.id}: ${a.value_name ?? a.value_id ?? ""}`)
    .filter((linha) => !linha.endsWith(": "));

  return { titulo: item.title, descricao, atributos, fotoBase64 };
}
