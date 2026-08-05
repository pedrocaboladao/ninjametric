import { listarVendasFinanceiras, normalizarSku } from "./financeiroService";
import { listarProdutos } from "./produtosService";

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
  motivo: string;
}

function dataISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Janela fixa do mês vigente (dia 1 até hoje) — não é um relatório de
// período escolhido, é uma lista de pendências "o que ainda falta
// corrigir esse mês". Reseta sozinha a cada mês novo.
function inicioDoMes(hoje: Date): Date {
  return new Date(hoje.getFullYear(), hoje.getMonth(), 1);
}

// Distância de edição clássica (quantos caracteres precisam mudar pra uma
// string virar a outra) — usada só pra sugerir "parece erro de digitação",
// não pra decidir nada sozinha.
function distanciaLevenshtein(a: string, b: string): number {
  const linhas = a.length + 1;
  const colunas = b.length + 1;
  const dp: number[][] = Array.from({ length: linhas }, () => new Array(colunas).fill(0));
  for (let i = 0; i < linhas; i++) dp[i][0] = i;
  for (let j = 0; j < colunas; j++) dp[0][j] = j;
  for (let i = 1; i < linhas; i++) {
    for (let j = 1; j < colunas; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[linhas - 1][colunas - 1];
}

// "Não está na planilha" vs "possível erro de grafia": se existe um SKU já
// cadastrado bem parecido (poucas letras de diferença, proporcional ao
// tamanho), é mais provável ser digitação errada do que produto novo —
// só um alerta pra revisar, não substitui o julgamento de quem corrige.
function motivoProvavel(sku: string, skusDaPlanilha: string[]): string {
  const alvo = normalizarSku(sku);
  let maisParecido: string | null = null;
  let menorDistancia = Infinity;
  for (const candidato of skusDaPlanilha) {
    const distancia = distanciaLevenshtein(alvo, candidato);
    if (distancia < menorDistancia) {
      menorDistancia = distancia;
      maisParecido = candidato;
    }
  }
  const limite = Math.max(2, Math.floor(alvo.length * 0.15));
  if (maisParecido !== null && menorDistancia > 0 && menorDistancia <= limite) {
    return `Possível erro de grafia — parecido com "${maisParecido}", que já está na planilha`;
  }
  return "Não está na planilha";
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

  const [{ vendas }, produtos] = await Promise.all([
    listarVendasFinanceiras(
      lojaIdFiltro,
      lojasPermitidas,
      dataISO(inicioDoMes(hoje)),
      dataISO(hoje),
      forcarAtualizacao
    ),
    listarProdutos(),
  ]);
  const skusDaPlanilha = produtos.map((p) => normalizarSku(p.sku));

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
        motivo: v.sku === null ? "Anúncio sem SKU cadastrado no Mercado Livre" : motivoProvavel(v.sku, skusDaPlanilha),
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
