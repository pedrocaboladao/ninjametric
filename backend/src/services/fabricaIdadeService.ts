import { pool } from "../db/pool";
import { dataIso } from "./fabricaData";
import { creditoPorCliente } from "./fabricaDevolucoesService";

// Idade do saldo: há quanto tempo cada loja está devendo.
//
// A conta corrente diz QUANTO a loja deve, nunca DESDE QUANDO — pagamento
// parcial é a regra aqui, e ninguém escolhe qual pedido foi quitado. Pra ter
// idade é preciso uma convenção, e a única honesta é a que a fábrica já usa na
// prática: paga-se o mais velho primeiro.
//
// Então os débitos entram em ordem de data e o que a loja pagou vai
// consumindo de cima pra baixo. O que sobra sem cobertura é o que está velho,
// e a data dele é a data do débito que sobrou.
//
// Vencimento sai da regra do ciclo: tudo que a loja pega em sete dias é pago
// no oitavo. Um pedido de segunda vence na segunda seguinte. Contar atraso a
// partir da compra faria toda venda nascer vencida.
const DIAS_ATE_VENCER = 8;

export interface FaixaIdade {
  rotulo: string;
  valor: number;
}

export interface IdadeCliente {
  clienteId: number;
  clienteNome: string;
  // quem cobra por esta loja — a cobrança sai na conta pai
  clientePaiId: number | null;
  clientePaiNome: string | null;
  total: number;
  aVencer: number;
  faixas: FaixaIdade[];
  // dia do débito mais velho ainda descoberto: é a idade real da dívida
  maisVelho: string | null;
  diasMaisVelho: number;
}

export interface IdadeSaldo {
  hoje: string;
  diasAteVencer: number;
  clientes: IdadeCliente[];
  totais: { total: number; aVencer: number; faixas: FaixaIdade[] };
}

// as faixas contam dias DEPOIS do vencimento, não depois da compra
const FAIXAS: Array<[string, number, number]> = [
  ["1 a 7 dias", 1, 7],
  ["8 a 30 dias", 8, 30],
  ["31 a 60 dias", 31, 60],
  ["61 a 90 dias", 61, 90],
  ["mais de 90 dias", 91, Number.MAX_SAFE_INTEGER],
];

interface Debito {
  data: string;
  valor: number;
}

function hojeSaoPaulo(): string {
  // en-CA dá AAAA-MM-DD. Sem o timeZone, no começo da noite o UTC já virou o
  // dia e toda dívida ganharia 24 horas de atraso que não existem.
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function diasEntre(de: string, ate: string): number {
  const a = Date.UTC(Number(de.slice(0, 4)), Number(de.slice(5, 7)) - 1, Number(de.slice(8, 10)));
  const b = Date.UTC(Number(ate.slice(0, 4)), Number(ate.slice(5, 7)) - 1, Number(ate.slice(8, 10)));
  return Math.round((b - a) / 86400000);
}

export async function idadeDoSaldo(): Promise<IdadeSaldo> {
  const hoje = hojeSaoPaulo();
  const creditoDevolucao = await creditoPorCliente();

  const [clientes, pedidos, creditos, pagamentos] = await Promise.all([
    pool.query<{ id: number; nome: string; pai_id: number | null; pai_nome: string | null }>(
      `SELECT c.id, c.nome, c.cliente_pai_id AS pai_id, p.nome AS pai_nome
       FROM fabrica_clientes c LEFT JOIN fabrica_clientes p ON p.id = c.cliente_pai_id`
    ),
    pool.query<{ cliente_id: number; data: string; total: string }>(
      `SELECT p.cliente_id, p.data, SUM(i.quantidade * i.preco_unitario) AS total
       FROM fabrica_pedidos p
       JOIN fabrica_pedido_itens i ON i.pedido_id = p.id
       WHERE p.status <> 'CANCELADO'
       GROUP BY p.id, p.cliente_id, p.data`
    ),
    // provisório fica de fora: ele não abate nada enquanto a loja não quitar
    pool.query<{ cliente_id: number; data: string; valor: string }>(
      "SELECT cliente_id, data, valor FROM fabrica_creditos WHERE NOT provisorio"
    ),
    pool.query<{ cliente_id: number; total: string }>(
      "SELECT cliente_id, SUM(valor) AS total FROM fabrica_pagamentos GROUP BY cliente_id"
    ),
  ]);

  const debitos = new Map<number, Debito[]>();
  const abatido = new Map<number, number>();

  const somar = (m: Map<number, number>, id: number, v: number) =>
    m.set(id, (m.get(id) ?? 0) + v);
  const empurrar = (id: number, d: Debito) => {
    const lista = debitos.get(id) ?? [];
    lista.push(d);
    debitos.set(id, lista);
  };

  for (const r of pedidos.rows) {
    empurrar(r.cliente_id, { data: dataIso(r.data), valor: Number(r.total) });
  }
  // crédito negativo é dívida (dívida carregada, ajuste pra mais); positivo abate
  for (const r of creditos.rows) {
    const v = Number(r.valor);
    if (v < 0) empurrar(r.cliente_id, { data: dataIso(r.data), valor: -v });
    else somar(abatido, r.cliente_id, v);
  }
  for (const r of pagamentos.rows) somar(abatido, r.cliente_id, Number(r.total));
  for (const [id, v] of creditoDevolucao) somar(abatido, id, v);

  const linhas: IdadeCliente[] = [];

  for (const c of clientes.rows) {
    const lista = (debitos.get(c.id) ?? []).slice().sort((a, b) => a.data.localeCompare(b.data));
    if (!lista.length) continue;

    let sobra = abatido.get(c.id) ?? 0;
    const faixas = FAIXAS.map(([rotulo]) => ({ rotulo, valor: 0 }));
    let aVencer = 0;
    let total = 0;
    let maisVelho: string | null = null;

    for (const d of lista) {
      // o mais velho é quitado primeiro: é como a fábrica cobra
      const coberto = Math.min(sobra, d.valor);
      sobra -= coberto;
      const aberto = d.valor - coberto;
      if (aberto <= 0.005) continue;

      total += aberto;
      const atraso = diasEntre(d.data, hoje) - DIAS_ATE_VENCER;
      if (atraso <= 0) {
        aVencer += aberto;
        continue;
      }
      if (maisVelho === null) maisVelho = d.data;
      const i = FAIXAS.findIndex(([, de, ate]) => atraso >= de && atraso <= ate);
      faixas[i < 0 ? FAIXAS.length - 1 : i].valor += aberto;
    }

    if (total <= 0.005) continue;

    linhas.push({
      clienteId: c.id,
      clienteNome: c.nome,
      clientePaiId: c.pai_id,
      clientePaiNome: c.pai_nome,
      total,
      aVencer,
      faixas,
      maisVelho,
      diasMaisVelho: maisVelho ? diasEntre(maisVelho, hoje) - DIAS_ATE_VENCER : 0,
    });
  }

  // quem está mais atrasado primeiro; empatou, quem deve mais
  linhas.sort((a, b) => b.diasMaisVelho - a.diasMaisVelho || b.total - a.total);

  const totais = {
    total: linhas.reduce((s, l) => s + l.total, 0),
    aVencer: linhas.reduce((s, l) => s + l.aVencer, 0),
    faixas: FAIXAS.map(([rotulo], i) => ({
      rotulo,
      valor: linhas.reduce((s, l) => s + l.faixas[i].valor, 0),
    })),
  };

  return { hoje, diasAteVencer: DIAS_ATE_VENCER, clientes: linhas, totais };
}
