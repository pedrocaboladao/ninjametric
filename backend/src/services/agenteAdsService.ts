import { pool } from "../db/pool";
import { listarCampanhasAds, type CampanhaAds } from "./adsService";
import { listarReceitaRealPorCampanha } from "./tacosService";

const formatCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format;

// Mesmas regras de "Insights" de frontend/src/components/Ads.tsx (linhas
// ~48-264), portadas pro backend porque o agente precisa rodar sozinho em
// segundo plano (não só quando alguém abre a tela) e guardar histórico —
// contexto vira string em vez de ReactNode, o resto da lógica é igual.

interface CampanhaComTacos extends CampanhaAds {
  tacosReal: number | null;
  acosIdeal: number | null;
  lucroReais: number | null;
}

function calcularLucroReais(c: { custo: number; receitaBase: number; acosIdeal: number | null }): number | null {
  if (c.acosIdeal === null) return null;
  if (c.custo === 0 && c.receitaBase === 0) return null;
  return c.receitaBase * (c.acosIdeal / 100) - c.custo;
}

const LIMIAR_ORCAMENTO_PARADO = 0.2;
const LIMIAR_TACOS_ORGANICO = 0.5;
const GASTO_MINIMO_SEM_VENDA = 20;

type Grupo = "semVenda" | "acimaMeta" | "orcamentoParado" | "dentroMeta" | null;

function grupoDaCampanha(c: CampanhaAds, diasPeriodo: number): Grupo {
  if (c.status !== "active" || c.custo === 0) return null;
  if (c.vendasTotais === 0) return "semVenda";
  if (c.acos > c.acosMeta) return "acimaMeta";
  if (c.orcamento > 0 && c.custo / (c.orcamento * diasPeriodo) < LIMIAR_ORCAMENTO_PARADO) return "orcamentoParado";
  return "dentroMeta";
}

type TipoInsight = "prejuizo" | "semVenda" | "margemSobra" | "orcamentoParado" | "organico";

const ACAO_POR_TIPO: Record<TipoInsight, string> = {
  prejuizo: "Cortar orçamento ou pausar agora",
  semVenda: "Pausar ou revisar o anúncio",
  margemSobra: "Considerar subir a meta de ACOS",
  orcamentoParado: "Aumentar orçamento — oportunidade de escalar",
  organico: "Testar reduzir investimento e comparar",
};

interface ObservacaoGerada {
  tipo: TipoInsight;
  contexto: string;
  acao: string;
}

function gerarObservacao(c: CampanhaComTacos, diasPeriodo: number): ObservacaoGerada | null {
  const grupo = grupoDaCampanha(c, diasPeriodo);
  let tipo: TipoInsight | null = null;
  let contexto = "";

  if (c.acosIdeal !== null && c.vendasTotais > 0 && c.acos > c.acosIdeal) {
    tipo = "prejuizo";
    contexto = `ACOS em ${c.acos.toFixed(0)}%, acima até da margem real (${c.acosIdeal.toFixed(0)}%) — cada venda está dando prejuízo.`;
  } else if (grupo === "semVenda" && c.custo >= GASTO_MINIMO_SEM_VENDA) {
    tipo = "semVenda";
    contexto = `Gastou ${formatCurrency(c.custo)} em ${diasPeriodo} dia${diasPeriodo > 1 ? "s" : ""} sem nenhuma venda atribuída.`;
  } else if (grupo === "acimaMeta" && c.acosIdeal !== null && c.acosIdeal > c.acosMeta) {
    tipo = "margemSobra";
    contexto = `ACOS em ${c.acos.toFixed(0)}% vs meta de ${c.acosMeta.toFixed(0)}% — mas a margem real aguentaria até ${c.acosIdeal.toFixed(0)}%.`;
  } else if (grupo === "orcamentoParado") {
    const pctOrcamento = c.orcamento > 0 ? (c.custo / (c.orcamento * diasPeriodo)) * 100 : 0;
    tipo = "orcamentoParado";
    contexto = `Gastando só ${pctOrcamento.toFixed(0)}% do orçamento diário, com ACOS saudável de ${c.acos.toFixed(0)}%.`;
  } else if (
    c.tacosReal !== null &&
    c.acosMeta > 0 &&
    c.vendasTotais > 0 &&
    c.tacosReal < c.acosMeta * LIMIAR_TACOS_ORGANICO
  ) {
    tipo = "organico";
    contexto = `TACOS real de ${c.tacosReal.toFixed(0)}% vs ACOS configurado de ${c.acosMeta.toFixed(0)}% — a maior parte da venda parece já vir sem o anúncio.`;
  }

  if (tipo === null) return null;
  return { tipo, contexto, acao: ACAO_POR_TIPO[tipo] };
}

function dataISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DIAS_JANELA = 7;

// Roda pra TODAS as lojas (sem filtro — o agente é admin-only, não faz
// sentido escopar por usuário) sobre os últimos 7 dias, mesma janela que a
// tela de Ads usa por padrão.
export async function verificarAgenteAds(): Promise<{ novas: number; resolvidasSozinhas: number }> {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - (DIAS_JANELA - 1) * 24 * 60 * 60 * 1000);
  const dataInicio = dataISO(inicio);
  const dataFim = dataISO(hoje);

  const [campanhas, receitas] = await Promise.all([
    listarCampanhasAds(undefined, undefined, dataInicio, dataFim),
    listarReceitaRealPorCampanha(undefined, undefined, dataInicio, dataFim),
  ]);

  const receitaPorChave = new Map(receitas.map((r) => [`${r.lojaId}-${r.campanhaId}`, r]));

  const campanhasComTacos: CampanhaComTacos[] = campanhas.map((c) => {
    const dados = receitaPorChave.get(`${c.lojaId}-${c.campanhaId}`);
    const receitaReal = dados?.receitaTotalReal ?? 0;
    const receitaBase = Math.max(receitaReal, c.vendasTotais);
    const tacosReal = receitaBase > 0 ? (c.custo / receitaBase) * 100 : null;
    const acosIdeal = dados?.acosIdeal ?? null;
    return { ...c, tacosReal, acosIdeal, lucroReais: calcularLucroReais({ custo: c.custo, receitaBase, acosIdeal }) };
  });

  let novas = 0;
  const chavesDetectadasPorLoja = new Map<number, string[]>();

  for (const c of campanhasComTacos) {
    const obs = gerarObservacao(c, DIAS_JANELA);
    if (!obs) continue;
    const chave = `${c.lojaId}-${c.campanhaId}`;
    if (!chavesDetectadasPorLoja.has(c.lojaId)) chavesDetectadasPorLoja.set(c.lojaId, []);
    chavesDetectadasPorLoja.get(c.lojaId)!.push(chave);

    const { rowCount } = await pool.query(
      `INSERT INTO agente_ads_observacoes (loja_id, campanha_id, campanha_nome, chave, tipo, contexto, acao)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (chave) WHERE status = 'pendente' DO NOTHING`,
      [c.lojaId, String(c.campanhaId), c.nome, chave, obs.tipo, obs.contexto, obs.acao]
    );
    if (rowCount && rowCount > 0) novas++;
  }

  let resolvidasSozinhas = 0;
  for (const [lojaId, chaves] of chavesDetectadasPorLoja) {
    const { rowCount } = await pool.query(
      `UPDATE agente_ads_observacoes
       SET status = 'resolvida', resolvido_por = 'sistema', resolvido_em = now()
       WHERE loja_id = $1 AND status = 'pendente' AND chave != ALL($2::text[])`,
      [lojaId, chaves]
    );
    resolvidasSozinhas += rowCount ?? 0;
  }
  // Lojas sem nenhuma observação detectada nesta rodada não entram no mapa
  // acima — fecha as pendentes delas também (senão nunca seriam resolvidas).
  const lojaIdsComCampanha = new Set(campanhasComTacos.map((c) => c.lojaId));
  const lojaIdsSemDeteccao = [...lojaIdsComCampanha].filter((id) => !chavesDetectadasPorLoja.has(id));
  for (const lojaId of lojaIdsSemDeteccao) {
    const { rowCount } = await pool.query(
      `UPDATE agente_ads_observacoes
       SET status = 'resolvida', resolvido_por = 'sistema', resolvido_em = now()
       WHERE loja_id = $1 AND status = 'pendente'`,
      [lojaId]
    );
    resolvidasSozinhas += rowCount ?? 0;
  }

  return { novas, resolvidasSozinhas };
}

export interface ObservacaoAds {
  id: number;
  lojaId: number;
  campanhaId: string;
  campanhaNome: string;
  tipo: string;
  contexto: string;
  acao: string;
  status: string;
  resolvidoPor: string | null;
  criadoEm: string;
  resolvidoEm: string | null;
  lojaNome: string;
}

export async function listarObservacoes(status?: "pendente" | "resolvida"): Promise<ObservacaoAds[]> {
  const { rows } = await pool.query<{
    id: number;
    loja_id: number;
    campanha_id: string;
    campanha_nome: string;
    tipo: string;
    contexto: string;
    acao: string;
    status: string;
    resolvido_por: string | null;
    criado_em: string;
    resolvido_em: string | null;
    loja_nome: string;
  }>(
    `SELECT o.id, o.loja_id, o.campanha_id, o.campanha_nome, o.tipo, o.contexto, o.acao, o.status,
            o.resolvido_por, o.criado_em, o.resolvido_em, l.nome AS loja_nome
     FROM agente_ads_observacoes o
     JOIN lojas l ON l.id = o.loja_id
     WHERE $1::text IS NULL OR o.status = $1
     ORDER BY (o.status = 'pendente') DESC, o.criado_em DESC
     LIMIT 200`,
    [status ?? null]
  );
  return rows.map((r) => ({
    id: r.id,
    lojaId: r.loja_id,
    campanhaId: r.campanha_id,
    campanhaNome: r.campanha_nome,
    tipo: r.tipo,
    contexto: r.contexto,
    acao: r.acao,
    status: r.status,
    resolvidoPor: r.resolvido_por,
    criadoEm: r.criado_em,
    resolvidoEm: r.resolvido_em,
    lojaNome: r.loja_nome,
  }));
}

export async function confirmarObservacao(id: number): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE agente_ads_observacoes SET status = 'resolvida', resolvido_por = 'usuario', resolvido_em = now()
     WHERE id = $1 AND status = 'pendente'`,
    [id]
  );
  if (!rowCount) {
    throw new Error("Observação não encontrada ou já resolvida.");
  }
}

const INTERVALO_MS = 4 * 60 * 60 * 1000; // 4h

export function iniciarVerificacaoAgenteAds(): void {
  async function verificar() {
    try {
      const resultado = await verificarAgenteAds();
      console.log(`Agente de Ads: ${resultado.novas} nova(s), ${resultado.resolvidasSozinhas} resolvida(s) sozinha(s).`);
    } catch (err) {
      console.error("Erro na verificação do agente de Ads:", err);
    }
  }
  verificar();
  setInterval(verificar, INTERVALO_MS);
}
