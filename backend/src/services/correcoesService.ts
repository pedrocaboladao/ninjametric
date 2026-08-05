import { listarVendasFinanceiras } from "./financeiroService";

export interface SkuSemCusto {
  lojaId: number;
  lojaNome: string;
  sku: string | null;
  itemId: string;
  titulo: string;
  ocorrencias: number;
  receitaAfetada: number;
  primeiraOcorrencia: string;
  ultimaOcorrencia: string;
}

// Janela fixa (não é um relatório de período escolhido, é uma lista de
// pendências "o que ainda falta corrigir") — 30 dias é suficiente pra
// pegar qualquer SKU que ainda não foi cadastrado na planilha sem
// precisar de uma busca retroativa grande (mesmo cuidado do DRE: evitar
// rajada de chamadas à API do Mercado Livre).
const DIAS_JANELA = 30;

function dataISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Agrupa por SKU (não por anúncio/item_id) sempre que o SKU existe — é o
// SKU que fica cadastrado na planilha, então um SKU usado em mais de um
// anúncio (ex.: variação Clássico/Premium) já sai corrigido dos dois de
// uma vez só quando alguém adiciona ele na planilha. Anúncio sem SKU
// nenhum cadastrado no Mercado Livre (problema anterior, mais grave) usa
// o item_id como chave, já que não tem outro jeito de agrupar.
export async function listarSkusSemCusto(
  lojaIdFiltro?: number,
  lojasPermitidas?: number[],
  forcarAtualizacao = false
): Promise<SkuSemCusto[]> {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - DIAS_JANELA * 24 * 60 * 60 * 1000);

  const { vendas } = await listarVendasFinanceiras(
    lojaIdFiltro,
    lojasPermitidas,
    dataISO(inicio),
    dataISO(hoje),
    forcarAtualizacao
  );

  const porChave = new Map<string, SkuSemCusto>();
  for (const v of vendas) {
    if (v.custoTotal !== null) continue;
    const chave = `${v.lojaId}-${v.sku ?? `__sem_sku__${v.itemId}`}`;
    const atual = porChave.get(chave);
    if (!atual) {
      porChave.set(chave, {
        lojaId: v.lojaId,
        lojaNome: v.lojaNome,
        sku: v.sku,
        itemId: v.itemId,
        titulo: v.titulo,
        ocorrencias: 1,
        receitaAfetada: v.receitaTotal,
        primeiraOcorrencia: v.dataCriacao,
        ultimaOcorrencia: v.dataCriacao,
      });
    } else {
      atual.ocorrencias += 1;
      atual.receitaAfetada += v.receitaTotal;
      if (v.dataCriacao < atual.primeiraOcorrencia) atual.primeiraOcorrencia = v.dataCriacao;
      if (v.dataCriacao > atual.ultimaOcorrencia) atual.ultimaOcorrencia = v.dataCriacao;
    }
  }

  return Array.from(porChave.values()).sort((a, b) => b.receitaAfetada - a.receitaAfetada);
}
