import { pool } from "../db/pool";
import { dataIso } from "./fabricaData";

// Bens da Fábrica: o maquinário, o caminhão, a empilhadeira.
//
// Comprar um bem não é gastar. Saiu dinheiro e entrou um caminhão que vale o
// mesmo tanto — o patrimônio não mudou. O que empobrece é o desgaste dele, e
// esse acontece um pouco por mês, pelos anos em que a máquina trabalha.
//
// Por isso a parcela do financiamento não abate o lucro: ela continua no
// contas a pagar, porque existe cheque pra pagar dia 17, mas quem entra no DRE
// é a depreciação. Se fosse a parcela, o mês seguinte ao último cheque
// pareceria R$ 15 mil melhor sem uma venda a mais ter acontecido.

export interface Bem {
  id: number;
  nome: string;
  tipo: "movel" | "imovel";
  valor: number;
  dataCompra: string;
  vidaUtilAnos: number;
  observacao: string | null;
  ativo: boolean;
  // derivados
  depreciacaoMensal: number;
  mesesDepreciados: number;
  mesesTotais: number;
  depreciacaoAcumulada: number;
  valorAtual: number;
  totalmenteDepreciado: boolean;
}

export interface BemEntrada {
  nome: string;
  tipo: "movel" | "imovel";
  valor: number;
  dataCompra: string;
  vidaUtilAnos: number;
  observacao: string | null;
  ativo: boolean;
}

interface Linha {
  id: number;
  nome: string;
  tipo: string;
  valor: string;
  data_compra: string;
  vida_util_anos: string;
  observacao: string | null;
  ativo: boolean;
}

function hoje(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

// Meses cheios entre duas datas AAAA-MM. O dia não conta: o mês da compra
// deprecia inteiro, senão um bem comprado dia 28 daria meio mês de conta
// quebrada em todo relatório.
function mesesEntre(de: string, ate: string): number {
  const [ay, am] = de.split("-").map(Number);
  const [by, bm] = ate.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

function montar(r: Linha, ate: string): Bem {
  const valor = Number(r.valor);
  const dataCompra = dataIso(r.data_compra);
  const vidaUtilAnos = Number(r.vida_util_anos);
  const mesesTotais = Math.round(vidaUtilAnos * 12);
  const depreciacaoMensal = mesesTotais > 0 ? valor / mesesTotais : 0;

  // +1 porque o mês da compra já deprecia. Preso ao total: um caminhão de 5
  // anos comprado há 8 não vale menos que zero.
  const decorridos = mesesEntre(dataCompra, ate) + 1;
  const mesesDepreciados = Math.max(0, Math.min(decorridos, mesesTotais));
  const depreciacaoAcumulada = depreciacaoMensal * mesesDepreciados;

  return {
    id: r.id,
    nome: r.nome,
    tipo: r.tipo as "movel" | "imovel",
    valor,
    dataCompra,
    vidaUtilAnos,
    observacao: r.observacao,
    ativo: r.ativo,
    depreciacaoMensal,
    mesesDepreciados,
    mesesTotais,
    depreciacaoAcumulada,
    valorAtual: valor - depreciacaoAcumulada,
    totalmenteDepreciado: mesesDepreciados >= mesesTotais,
  };
}

export async function listarBens(): Promise<Bem[]> {
  const { rows } = await pool.query<Linha>(
    `SELECT id, nome, tipo, valor, data_compra, vida_util_anos, observacao, ativo
     FROM fabrica_bens ORDER BY valor DESC, id`
  );
  const ate = hoje().slice(0, 7);
  return rows.map((r) => montar(r, ate));
}

function valores(e: BemEntrada) {
  return [e.nome, e.tipo, e.valor, e.dataCompra, e.vidaUtilAnos, e.observacao, e.ativo];
}

export async function criarBem(e: BemEntrada): Promise<{ id: number }> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO fabrica_bens (nome, tipo, valor, data_compra, vida_util_anos, observacao, ativo)
     VALUES ($1,$2,$3,$4::date,$5,$6,$7) RETURNING id`,
    valores(e)
  );
  return { id: rows[0].id };
}

export async function atualizarBem(id: number, e: BemEntrada): Promise<void> {
  await pool.query(
    `UPDATE fabrica_bens
     SET nome = $2, tipo = $3, valor = $4, data_compra = $5::date,
         vida_util_anos = $6, observacao = $7, ativo = $8
     WHERE id = $1`,
    [id, ...valores(e)]
  );
}

export async function excluirBem(id: number): Promise<void> {
  await pool.query("DELETE FROM fabrica_bens WHERE id = $1", [id]);
}

export interface DepreciacaoDoMes {
  total: number;
  porBem: { nome: string; valor: number }[];
}

// Depreciação de UM mês de competência. Só entra bem ativo, já comprado, e que
// ainda não chegou ao fim da vida útil — máquina totalmente depreciada não
// custa mais nada no papel, mesmo que ainda esteja rodando.
export async function depreciacaoDoMes(competencia: string): Promise<DepreciacaoDoMes> {
  const mes = competencia.slice(0, 7);
  const { rows } = await pool.query<Linha>(
    `SELECT id, nome, tipo, valor, data_compra, vida_util_anos, observacao, ativo
     FROM fabrica_bens
     WHERE ativo = TRUE AND to_char(data_compra, 'YYYY-MM') <= $1
     ORDER BY valor DESC`,
    [mes]
  );

  const porBem: { nome: string; valor: number }[] = [];
  let total = 0;
  for (const r of rows) {
    const valor = Number(r.valor);
    const mesesTotais = Math.round(Number(r.vida_util_anos) * 12);
    if (mesesTotais <= 0) continue;

    // qual parcela da vida útil este mês é. 1 = mês da compra.
    // Sem clamp de propósito: com clamp, o mês 60 de um bem de 60 e o mês 900
    // ficariam iguais, e o último mês de vida deixaria de depreciar.
    const parcela = mesesEntre(dataIso(r.data_compra), mes) + 1;
    if (parcela < 1 || parcela > mesesTotais) continue;

    const mensal = valor / mesesTotais;
    total += mensal;
    porBem.push({ nome: r.nome, valor: mensal });
  }
  return { total, porBem };
}
