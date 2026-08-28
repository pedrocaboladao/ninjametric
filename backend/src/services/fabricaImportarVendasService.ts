import { pool } from "../db/pool";
import { conferirPlanilhaVendas, type LinhaPlanilha } from "./fabricaVendasPlanilhaService";

// Transforma a planilha conferida em pedidos.
//
// A conferência já disse o que está pronto e o que tem problema. Aqui só entra
// o que está pronto: linha sem produto, sem cliente ou sem data não vira pedido
// nenhum. O operador cadastra o que falta e sobe de novo — a linha que já
// entrou é reconhecida e não duplica.
//
// As linhas viram UM pedido por cliente e data. Um pedido por linha encheria a
// tela de pedidos de uma linha só, e é a mesma compra: a loja levou cinco
// produtos num dia, isso é um pedido de cinco itens.

export interface ResultadoImportacao {
  pedidosCriados: number;
  itensLancados: number;
  valorLancado: number;
  puladas: number;
  // o que impediu cada linha pulada, agrupado pra não virar uma lista de 200
  motivos: Record<string, number>;
  // Origem diferente já ocupando o mesmo período — nada foi lançado.
  //
  // Agosto de 2026 entrou duas vezes: primeiro por planilha, depois pelo Bling.
  // A dedução de linha repetida é por origem (canal + documento + sku), então
  // uma venda que entrou como planilha passa de novo como Bling sem nenhum
  // aviso. Deu R$ 529.525,65 de faturamento que nunca existiu.
  conflitoDeOrigem: string[];
}

interface Grupo {
  clienteId: number;
  data: string;
  linhas: LinhaPlanilha[];
}

export async function importarPlanilhaVendas(
  texto: string,
  origem: string
): Promise<ResultadoImportacao> {
  const conf = await conferirPlanilhaVendas(texto, origem);

  // Recusa antes de escrever qualquer coisa: o mesmo período já lançado por
  // outra fonte quase certamente é a mesma venda com outro rótulo. Melhor parar
  // e obrigar alguém a escolher a fonte do que somar dois faturamentos.
  const datas = conf.linhas.map((l) => l.data).filter((d): d is string => Boolean(d)).sort();
  const marca = `Importado de planilha (${origem})`;
  const conflitoDeOrigem: string[] = [];
  if (datas.length) {
    const { rows } = await pool.query<{ observacao: string | null }>(
      `SELECT DISTINCT observacao FROM fabrica_pedidos
        WHERE data BETWEEN $1::date AND $2::date
          AND observacao IS NOT NULL
          AND observacao LIKE 'Importado de planilha (%'
          AND observacao <> $3`,
      [datas[0], datas[datas.length - 1], marca]
    );
    for (const r of rows) if (r.observacao) conflitoDeOrigem.push(r.observacao);
  }
  if (conflitoDeOrigem.length) {
    return {
      pedidosCriados: 0,
      itensLancados: 0,
      valorLancado: 0,
      puladas: conf.linhas.length,
      motivos: { "período já lançado por outra fonte": conf.linhas.length },
      conflitoDeOrigem,
    };
  }

  const motivos: Record<string, number> = {};
  const prontas: LinhaPlanilha[] = [];
  for (const l of conf.linhas) {
    if (l.jaImportada) {
      motivos["já importada antes"] = (motivos["já importada antes"] ?? 0) + 1;
      continue;
    }
    if (l.problema || l.produtoId === null || l.clienteId === null || !l.data) {
      const m = l.problema ?? "faltando dado";
      motivos[m] = (motivos[m] ?? 0) + 1;
      continue;
    }
    prontas.push(l);
  }

  // agrupa por cliente e dia: a loja que levou cinco produtos numa terça fez um
  // pedido de cinco itens, não cinco pedidos
  const grupos = new Map<string, Grupo>();
  for (const l of prontas) {
    const chave = `${l.clienteId}|${l.data}`;
    const g = grupos.get(chave) ?? { clienteId: l.clienteId!, data: l.data!, linhas: [] };
    g.linhas.push(l);
    grupos.set(chave, g);
  }

  let pedidosCriados = 0;
  let itensLancados = 0;
  let valorLancado = 0;

  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    for (const g of grupos.values()) {
      const { rows } = await cliente.query<{ id: number }>(
        `INSERT INTO fabrica_pedidos (cliente_id, data, status, observacao)
         VALUES ($1, $2::date, 'ABERTO', $3) RETURNING id`,
        [g.clienteId, g.data, `Importado de planilha (${origem})`]
      );
      const pedidoId = rows[0].id;
      pedidosCriados++;

      for (const l of g.linhas) {
        await cliente.query(
          `INSERT INTO fabrica_pedido_itens (pedido_id, produto_id, quantidade, preco_unitario)
           VALUES ($1, $2, $3, $4)`,
          [pedidoId, l.produtoId, l.quantidade, l.precoUnitario]
        );
        itensLancados++;
        valorLancado += l.total;

        // marca como importada só quando há documento: sem número de pedido não
        // dá pra reconhecer a mesma venda numa segunda subida, e inventar uma
        // chave faria a próxima importação pular linha que nunca entrou
        if (l.documento) {
          await cliente.query(
            `INSERT INTO fabrica_venda_importada
               (origem, documento, sku, cliente_id, quantidade, valor, data_venda, pedido_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8)
             ON CONFLICT DO NOTHING`,
            [origem, l.documento, l.sku, l.clienteId, l.quantidade, l.total, l.data, pedidoId]
          );
        }
      }
    }
    await cliente.query("COMMIT");
  } catch (err) {
    await cliente.query("ROLLBACK");
    throw err;
  } finally {
    cliente.release();
  }

  return {
    pedidosCriados,
    itensLancados,
    valorLancado: Number(valorLancado.toFixed(2)),
    puladas: conf.linhas.length - prontas.length,
    motivos,
    conflitoDeOrigem: [],
  };
}

// SKUs que apareceram na planilha e não estão cadastrados.
//
// É o alerta que o Hudson pediu: em vez de a linha sumir com "SKU não
// cadastrado" e alguém ter que caçar qual era, a tela lista os que faltam com o
// que a planilha sabe deles, pra cadastrar na hora e subir de novo.
export interface SkuFaltando {
  sku: string;
  linhas: number;
  quantidade: number;
  valor: number;
  precoUnitario: number;
  clientes: string[];
}

// Os nomes que vieram do ERP e não casaram com cliente nenhum. É o par do
// skusFaltando: sem cliente a linha também não vira pedido, e antes disso o
// operador só via "cliente não cadastrado" repetido mil vezes sem saber quantos
// nomes diferentes estavam por trás.
export interface ClienteFaltando {
  nome: string;
  linhas: number;
  valor: number;
  // o nome casou com mais de um cliente: não é cadastro que falta, é escolha
  ambiguo: boolean;
  documentos: string[];
}

export function clientesFaltando(linhas: LinhaPlanilha[]): ClienteFaltando[] {
  const mapa = new Map<string, ClienteFaltando>();
  for (const l of linhas) {
    if (l.clienteId !== null || !l.cliente) continue;
    const c = mapa.get(l.cliente) ?? {
      nome: l.cliente,
      linhas: 0,
      valor: 0,
      ambiguo: false,
      documentos: [],
    };
    c.linhas++;
    c.valor += l.total;
    if (l.problema?.includes("ambíguo")) c.ambiguo = true;
    // os primeiros pedidos servem de conferência: dá pra abrir no ERP e ver
    // que é a loja mesmo antes de ligar o apelido
    if (l.documento && c.documentos.length < 3 && !c.documentos.includes(l.documento)) {
      c.documentos.push(l.documento);
    }
    mapa.set(l.cliente, c);
  }
  return [...mapa.values()].sort((a, b) => b.valor - a.valor);
}

export function skusFaltando(linhas: LinhaPlanilha[]): SkuFaltando[] {
  const mapa = new Map<string, SkuFaltando>();
  for (const l of linhas) {
    if (l.produtoId !== null || !l.sku) continue;
    const s = mapa.get(l.sku) ?? {
      sku: l.sku,
      linhas: 0,
      quantidade: 0,
      valor: 0,
      precoUnitario: 0,
      clientes: [],
    };
    s.linhas++;
    s.quantidade += l.quantidade;
    s.valor += l.total;
    if (l.cliente && !s.clientes.includes(l.cliente)) s.clientes.push(l.cliente);
    mapa.set(l.sku, s);
  }
  // o preço sai do que a planilha cobrou, não de um chute: é o valor que a loja
  // pagou de verdade, e serve de sugestão na hora de cadastrar
  for (const s of mapa.values()) {
    s.precoUnitario = s.quantidade > 0 ? Number((s.valor / s.quantidade).toFixed(2)) : 0;
  }
  return [...mapa.values()].sort((a, b) => b.valor - a.valor);
}
