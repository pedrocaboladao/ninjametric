import { listLojas } from "./tokenStore";
import { searchPendingQuestions, getUserNicknames } from "./mercadoLivreQuestions";
import { getItemsBasicInfo } from "./mercadoLivreApi";

export interface PerguntaPendente {
  id: number;
  lojaId: number;
  lojaNome: string;
  texto: string;
  criadoEm: string;
  comprador: string;
  produto: {
    id: string;
    titulo: string;
    preco: number;
    foto: string;
    linkMl: string;
  } | null;
}

export async function listarPerguntasPendentes(): Promise<PerguntaPendente[]> {
  const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null);

  const porLoja = await Promise.all(
    lojas.map(async (loja) => {
      const questions = await searchPendingQuestions(loja.id, loja.ml_user_id as number);
      const itemIds = questions.map((q) => q.item_id);
      const askerIds = questions.map((q) => q.from.id);
      const [itens, nicknames] = await Promise.all([
        getItemsBasicInfo(loja.id, itemIds),
        getUserNicknames(loja.id, askerIds),
      ]);
      return { loja, questions, itens, nicknames };
    })
  );

  const perguntas: PerguntaPendente[] = [];
  for (const { loja, questions, itens, nicknames } of porLoja) {
    for (const q of questions) {
      const item = itens.get(q.item_id);
      perguntas.push({
        id: q.id,
        lojaId: loja.id,
        lojaNome: loja.nome,
        texto: q.text,
        criadoEm: q.date_created,
        comprador: nicknames.get(q.from.id) ?? `Usuário ${q.from.id}`,
        produto: item
          ? {
              id: item.id,
              titulo: item.title,
              preco: item.price,
              foto: item.thumbnail,
              linkMl: item.permalink,
            }
          : null,
      });
    }
  }

  perguntas.sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime());
  return perguntas;
}
