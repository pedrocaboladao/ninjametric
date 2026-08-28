import { buscarVendas, paraTexto } from "./blingPedidosService";
import {
  clientesFaltando,
  importarPlanilhaVendas,
  skusFaltando,
  type ClienteFaltando,
  type SkuFaltando,
} from "./fabricaImportarVendasService";
import { conferirPlanilhaVendas } from "./fabricaVendasPlanilhaService";

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
  erro: string | null;
}

let ultima: UltimaRodada | null = null;
let rodando = false;

export function ultimaRodadaAutomatica(): UltimaRodada | null {
  return ultima;
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
    // depois de importar: o que continua sem par e o que precisa ser cadastrado.
    // Roda a conferencia de novo em vez de reaproveitar a de dentro do import —
    // sao dois mil e poucos itens em memoria, sem uma chamada ao Bling.
    const conf = await conferirPlanilhaVendas(texto, "BLING");
    base.skusFaltando = skusFaltando(conf.linhas);
    base.clientesFaltando = clientesFaltando(conf.linhas);
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
export async function rodarEGuardar(): Promise<UltimaRodada | null> {
  if (rodando) return ultima;
  rodando = true;
  try {
    ultima = await rodarSincronizacaoAutomatica();
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
            : "")
      );
    return ultima;
  } finally {
    rodando = false;
  }
}

// Quantos milissegundos faltam pra próxima HORA no fuso de Maringá.
function ateProximaHora(): number {
  const agora = new Date();
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(agora);
  const pega = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? 0);
  const segundosNoDia = (pega("hour") % 24) * 3600 + pega("minute") * 60 + pega("second");
  const alvo = HORA * 3600;
  const faltam = alvo > segundosNoDia ? alvo - segundosNoDia : 24 * 3600 - segundosNoDia + alvo;
  return faltam * 1000;
}

export function iniciarSincronizacaoVendas(): void {
  // não roda ao subir: deploy no meio da tarde dispararia dez minutos de Bling
  // sem ninguém pedir, e o horário existe justamente pra isso acontecer quando
  // ninguém está usando a cota
  const agendar = () => {
    setTimeout(() => {
      void rodarEGuardar().finally(agendar);
    }, ateProximaHora());
  };
  agendar();
  console.log(`[sinc-automatica] agendada para ${HORA}h (${FUSO})`);
}
