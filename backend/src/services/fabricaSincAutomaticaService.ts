import { pool } from "../db/pool";
import { buscarVendas, paraTexto } from "./blingPedidosService";
import {
  clientesFaltando,
  importarPlanilhaVendas,
  skusFaltando,
  type ClienteFaltando,
  type SkuFaltando,
} from "./fabricaImportarVendasService";
import { conferirPlanilhaVendas } from "./fabricaVendasPlanilhaService";
import { vendaSemCusto, type VendaSemCusto } from "./fabricaPedidosService";

// Puxa a venda do Bling e lança sozinha, toda manhã.
//
// Até aqui alguém tinha que abrir a tela e clicar. Pra uso diário isso quebra na
// primeira semana corrida — e o alerta de SKU novo só acende quando a
// sincronização roda, então esquecer de rodar é justamente o que esconde o
// problema que o alerta existe pra mostrar.
//
// Lança de verdade, não só confere. É seguro porque a importação já sabe pular:
// linha sem produto, sem cliente ou sem data não vira pedido, e linha que já
// entrou é reconhecida e não duplica. O que não entrou fica no relatório com o
// motivo, pro operador resolver e o dia seguinte pegar sozinho.
//
// Sete dias pra trás, não um. Pedido chega atrasado, nota sai no dia seguinte, e
// máquina que dorme num feriado perderia o movimento. Repetir dia já importado
// não custa nada — a importação reconhece.

const DIAS_PRA_TRAS = 7;
const HORA = 6; // 6h de Maringá
const FUSO = "America/Sao_Paulo";
// Espera antes de recuperar um dia perdido: o deploy ainda está assentando, e
// dez minutos de Bling concorrendo com o start do container não ajuda ninguém.
const ATRASO_RECUPERACAO_MS = 2 * 60 * 1000;

export interface UltimaRodada {
  iniciadoEm: string;
  terminadoEm: string;
  de: string;
  ate: string;
  pedidosLidos: number;
  itensLidos: number;
  falhas: Array<{ id: number; motivo: string }>;
  pedidosCriados: number;
  itensLancados: number;
  valorLancado: number;
  puladas: number;
  motivos: Record<string, number>;
  // Quem ficou de fora, com nome e sobrenome.
  //
  // A primeira rodada disse "SKU não cadastrado: 1" e mais nada. Contar o que
  // falta sem dizer o que e nao ajuda ninguem a cadastrar: e um alerta que so
  // informa que existe um problema, e deixa a procura pro operador.
  skusFaltando: SkuFaltando[];
  clientesFaltando: ClienteFaltando[];
  // Venda que entrou sem custo — margem de 100% no dia.
  //
  // O custo vem do cadastro do produto, nao do Bling. Quando ele nao entra, o
  // dia fica com margem de 100% e o lucro do mes sobe sozinho. Em 31/08/2026
  // foram R$ 102.551,93 em 604 itens, e ninguem reparou ate alguem estranhar o
  // lucro alto demais.
  semCusto: VendaSemCusto;
  erro: string | null;
}

export type OrigemRodada = "relogio" | "recuperacao" | "manual";

export interface LinhaHistorico {
  dia: string;
  origem: OrigemRodada;
  iniciadoEm: string;
  terminadoEm: string | null;
  pedidosCriados: number;
  itensLancados: number;
  valorLancado: number;
  erro: string | null;
}

let ultima: UltimaRodada | null = null;
let rodando = false;

export function ultimaRodadaAutomatica(): UltimaRodada | null {
  return ultima;
}

// Memória não sobrevive a deploy, e deploy aqui acontece várias vezes por dia.
// Sem isto a tela dizia "nunca rodou" para quem tinha rodado às 6h — e dizia a
// mesma coisa para quem não rodou, que é o caso que precisa aparecer.
async function gravarRodada(u: UltimaRodada, origem: OrigemRodada): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO fabrica_sinc_automatica
         (dia, origem, iniciado_em, terminado_em, resultado, erro)
       VALUES ($1::date, $2, $3::timestamptz, $4::timestamptz, $5::jsonb, $6)`,
      [u.ate, origem, u.iniciadoEm, u.terminadoEm, JSON.stringify(u), u.erro]
    );
  } catch (err) {
    // perder o registro é ruim; perder a importação por causa dele seria pior
    console.error("[sinc-automatica] gravar", err);
  }
}

export async function historicoAutomatico(limite = 14): Promise<LinhaHistorico[]> {
  const { rows } = await pool.query<{
    dia: string;
    origem: OrigemRodada;
    iniciado_em: Date;
    terminado_em: Date | null;
    resultado: UltimaRodada | null;
    erro: string | null;
  }>(
    `SELECT to_char(dia,'YYYY-MM-DD') AS dia, origem, iniciado_em, terminado_em, resultado, erro
       FROM fabrica_sinc_automatica
      ORDER BY id DESC
      LIMIT $1`,
    [limite]
  );
  return rows.map((r) => ({
    dia: r.dia,
    origem: r.origem,
    iniciadoEm: r.iniciado_em.toISOString(),
    terminadoEm: r.terminado_em ? r.terminado_em.toISOString() : null,
    pedidosCriados: r.resultado?.pedidosCriados ?? 0,
    itensLancados: r.resultado?.itensLancados ?? 0,
    valorLancado: r.resultado?.valorLancado ?? 0,
    erro: r.erro,
  }));
}

/** A última que terminou sem erro. É dela que sai o "está atrasada?". */
export async function ultimoDiaComSucesso(): Promise<string | null> {
  const { rows } = await pool.query<{ dia: string }>(
    `SELECT to_char(dia,'YYYY-MM-DD') AS dia
       FROM fabrica_sinc_automatica
      WHERE erro IS NULL
      ORDER BY id DESC
      LIMIT 1`
  );
  return rows[0]?.dia ?? null;
}

async function diaJaRodouSemErro(dia: string): Promise<boolean> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM fabrica_sinc_automatica
      WHERE dia = $1::date AND erro IS NULL`,
    [dia]
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

export function rodadaEmAndamento(): boolean {
  return rodando;
}

function diaIso(d: Date): string {
  // a data tem que ser a de Maringá, não a do relógio do servidor: às 6h de
  // Brasília um servidor em UTC já virou o dia, e a janela sairia deslocada
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(d);
}

export async function rodarSincronizacaoAutomatica(): Promise<UltimaRodada> {
  const inicio = new Date();
  const ate = diaIso(inicio);
  const de = diaIso(new Date(inicio.getTime() - DIAS_PRA_TRAS * 24 * 60 * 60 * 1000));
  const base: UltimaRodada = {
    iniciadoEm: inicio.toISOString(),
    terminadoEm: inicio.toISOString(),
    de,
    ate,
    pedidosLidos: 0,
    itensLidos: 0,
    falhas: [],
    pedidosCriados: 0,
    itensLancados: 0,
    valorLancado: 0,
    puladas: 0,
    motivos: {},
    skusFaltando: [],
    clientesFaltando: [],
    semCusto: { itens: 0, pedidos: 0, valor: 0, skus: [] },
    erro: null,
  };
  try {
    const r = await buscarVendas(de, ate);
    base.pedidosLidos = r.pedidos;
    base.itensLidos = r.itens.length;
    base.falhas = r.falhas;
    // pedido que voltou sem item é 429 comido em silêncio; lançar em cima disso
    // criaria venda pela metade, e o dia seguinte não corrigiria — a linha que
    // entrou errada já conta como importada
    if (r.falhas.length > 0) {
      base.erro = `${r.falhas.length} pedido(s) não vieram inteiros do Bling; não lancei nada.`;
      return base;
    }
    const texto = paraTexto(r.itens);
    const imp = await importarPlanilhaVendas(texto, "BLING");
    base.pedidosCriados = imp.pedidosCriados;
    base.itensLancados = imp.itensLancados;
    base.valorLancado = imp.valorLancado;
    base.puladas = imp.puladas;
    base.motivos = imp.motivos;
    if (imp.conflitoDeOrigem.length) {
      base.erro =
        `O período já tem pedido lançado por outra fonte (${imp.conflitoDeOrigem.join(", ")}). ` +
        "Não lancei nada: seria a mesma venda contada duas vezes.";
      return base;
    }
    // depois de importar: o que continua sem par e o que precisa ser cadastrado.
    // Roda a conferencia de novo em vez de reaproveitar a de dentro do import —
    // sao dois mil e poucos itens em memoria, sem uma chamada ao Bling.
    const conf = await conferirPlanilhaVendas(texto, "BLING");
    base.skusFaltando = skusFaltando(conf.linhas);
    base.clientesFaltando = clientesFaltando(conf.linhas);
    // olha o periodo inteiro, nao so o que acabou de entrar: item que ficou sem
    // custo numa rodada anterior continua zerado e continua inflando a margem
    base.semCusto = await vendaSemCusto(de, ate);
  } catch (err) {
    base.erro = err instanceof Error ? err.message : "falha na sincronização automática";
  } finally {
    base.terminadoEm = new Date().toISOString();
  }
  return base;
}

// Guarda o resultado, inclusive quando alguem dispara a mao. A primeira versao
// devolvia o resultado so na resposta HTTP: quem fechou a aba antes de terminar
// nao descobria mais como foi, e "ultima rodada" continuava dizendo que nunca
// rodou. Rodada e rodada, tenha vindo do relogio ou do botao.
export async function rodarEGuardar(
  origem: OrigemRodada = "manual"
): Promise<UltimaRodada | null> {
  if (rodando) return ultima;
  rodando = true;
  try {
    ultima = await rodarSincronizacaoAutomatica();
    await gravarRodada(ultima, origem);
    if (ultima.erro) console.error("[sinc-automatica]", ultima.erro);
    else
      console.log(
        `[sinc-automatica] ${ultima.de}..${ultima.ate} · ${ultima.pedidosCriados} pedido(s), ` +
          `${ultima.itensLancados} item(ns), ${ultima.puladas} pulada(s)` +
          (ultima.skusFaltando.length
            ? ` · SKU a cadastrar: ${ultima.skusFaltando.map((s) => s.sku).join(", ")}`
            : "") +
          (ultima.clientesFaltando.length
            ? ` · cliente a cadastrar: ${ultima.clientesFaltando.map((c) => c.nome).join(", ")}`
            : "") +
          (ultima.semCusto.itens
            ? ` · SEM CUSTO: ${ultima.semCusto.itens} item(ns) em ${ultima.semCusto.pedidos} pedido(s)`
            : "")
      );
    return ultima;
  } finally {
    rodando = false;
  }
}

// Quantos milissegundos faltam pra próxima HORA no fuso de Maringá.
function segundosNoDiaMaringa(): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const pega = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? 0);
  return (pega("hour") % 24) * 3600 + pega("minute") * 60 + pega("second");
}

function ateProximaHora(): number {
  const segundosNoDia = segundosNoDiaMaringa();
  const alvo = HORA * 3600;
  const faltam = alvo > segundosNoDia ? alvo - segundosNoDia : 24 * 3600 - segundosNoDia + alvo;
  return faltam * 1000;
}

// O dia perdido.
//
// O agendamento só olha pra frente: subiu às 7h, agenda pras 6h de amanhã e o
// dia de hoje passa em branco — sem erro, sem aviso, sem ninguém saber. E
// deploy depois das 6h é o caso comum, não a exceção.
//
// Então, ao subir, se a janela de hoje já passou e nenhuma rodada de hoje
// terminou bem, recupera. Não é "rodar ao subir": é rodar o que ficou faltando.
// Quem sobe às 5h não dispara nada, e quem já rodou hoje também não.
async function recuperarDiaPerdido(): Promise<void> {
  try {
    if (segundosNoDiaMaringa() < HORA * 3600) return;
    const hoje = diaIso(new Date());
    if (await diaJaRodouSemErro(hoje)) return;
    console.log(`[sinc-automatica] ${hoje} ainda não rodou e a janela já passou; recuperando`);
    await rodarEGuardar("recuperacao");
  } catch (err) {
    console.error("[sinc-automatica] recuperar", err);
  }
}

export function iniciarSincronizacaoVendas(): void {
  // o relógio continua mandando: a rodada normal é às 6h e não dispara no boot
  const agendar = () => {
    setTimeout(() => {
      void rodarEGuardar("relogio").finally(agendar);
    }, ateProximaHora());
  };
  agendar();
  // a recuperação espera o deploy assentar antes de pedir 7 dias ao Bling
  setTimeout(() => void recuperarDiaPerdido(), ATRASO_RECUPERACAO_MS);
  console.log(`[sinc-automatica] agendada para ${HORA}h (${FUSO})`);
}
