import { pool } from "../db/pool";
import { normalizarSku } from "./financeiroService";

// Como o ERP chama cada cliente.
//
// O Bling manda razão social — "MESTRE DO IMPERMEABILIZANTE E PRODUTOS LTDA" —
// e o cadastro daqui é o nome de porta, "Mestre do Impermeabilizante". Casar
// por nome exato deixava 1.673 de 1.832 linhas de agosto/2026 sem cliente.
//
// São três jeitos de casar, nesta ordem:
//
//   1. nome igual         o caminho de quem sobe planilha montada à mão, que
//                         escreve o nome do jeito que está no cadastro
//   2. apelido            o que foi ensinado uma vez e vale pra sempre
//   3. prefixo            "MESTREDOIMPERMEABILIZANTEEPRODUTOSLTDA" começa com
//                         "MESTREDOIMPERMEABILIZANTE" — resolve a maioria sem
//                         ninguém precisar cadastrar nada
//
// O prefixo só vale quando **um** cliente casa. Catedral Ferramentas e Catedral
// Impermeabilizantes convivem porque nenhum dos dois é prefixo do outro; se um
// dia dois casarem com o mesmo nome, a linha fica sem cliente e aparece na tela
// pra alguém dizer qual é — melhor do que escolher no chute e lançar a venda na
// loja errada.

export interface ClienteApelido {
  id: number;
  clienteId: number;
  clienteNome: string;
  apelido: string;
}

export function chaveApelido(nome: string): string {
  return normalizarSku(String(nome ?? "").trim());
}

export interface ClienteBasico {
  id: number;
  nome: string;
}

// Casa o nome que veio de fora com o cliente do cadastro. Recebe as duas
// tabelas de uma vez porque a conferência roda isso linha a linha — são
// milhares — e ir ao banco em cada uma custaria mais que a conferência toda.
export function casarCliente(
  nome: string,
  porNome: Map<string, ClienteBasico>,
  porApelido: Map<string, ClienteBasico>,
  clientes: ClienteBasico[]
): { cliente: ClienteBasico | null; ambiguo: boolean } {
  const chave = chaveApelido(nome);
  if (!chave) return { cliente: null, ambiguo: false };

  const direto = porNome.get(chave) ?? porApelido.get(chave);
  if (direto) return { cliente: direto, ambiguo: false };

  const candidatos = clientes.filter((c) => {
    const k = chaveApelido(c.nome);
    // Quatro é o piso: "CASG" é nome de cliente de verdade, e cortar em cinco
    // deixava justamente ele de fora. Abaixo disso uma sigla casaria com meio
    // cadastro — e mesmo aqui quem segura é a regra do candidato único.
    return k.length >= 4 && chave.startsWith(k);
  });
  if (candidatos.length === 1) return { cliente: candidatos[0], ambiguo: false };
  return { cliente: null, ambiguo: candidatos.length > 1 };
}

export async function listarApelidos(): Promise<ClienteApelido[]> {
  const { rows } = await pool.query<{
    id: number;
    cliente_id: number;
    cliente_nome: string;
    apelido: string;
  }>(
    `SELECT a.id, a.cliente_id, c.nome AS cliente_nome, a.apelido
       FROM fabrica_cliente_apelidos a
       JOIN fabrica_clientes c ON c.id = a.cliente_id
      ORDER BY c.nome, a.apelido`
  );
  return rows.map((r) => ({
    id: r.id,
    clienteId: r.cliente_id,
    clienteNome: r.cliente_nome,
    apelido: r.apelido,
  }));
}

export async function criarApelido(clienteId: number, apelido: string): Promise<ClienteApelido> {
  const nome = String(apelido ?? "").trim();
  const chave = chaveApelido(nome);
  if (!chave) throw new Error("Informe o nome que o ERP usa.");

  const { rows: dono } = await pool.query<{ id: number; nome: string }>(
    "SELECT id, nome FROM fabrica_clientes WHERE id = $1",
    [clienteId]
  );
  if (!dono.length) throw new Error("Cliente não encontrado.");

  // Já apontando pra outro cliente: trocar calado faria a venda mudar de loja
  // sem ninguém pedir.
  const { rows: existe } = await pool.query<{ nome: string; cliente_id: number }>(
    `SELECT c.nome, a.cliente_id
       FROM fabrica_cliente_apelidos a
       JOIN fabrica_clientes c ON c.id = a.cliente_id
      WHERE a.chave = $1`,
    [chave]
  );
  if (existe.length) {
    if (existe[0].cliente_id === clienteId) {
      throw new Error(`"${nome}" já está ligado a ${existe[0].nome}.`);
    }
    throw new Error(
      `"${nome}" já está ligado a ${existe[0].nome}. Apague aquele apelido antes de ligar aqui.`
    );
  }

  const { rows } = await pool.query<{ id: number }>(
    "INSERT INTO fabrica_cliente_apelidos (cliente_id, apelido, chave) VALUES ($1, $2, $3) RETURNING id",
    [clienteId, nome, chave]
  );
  return { id: rows[0].id, clienteId, clienteNome: dono[0].nome, apelido: nome };
}

export async function excluirApelido(id: number): Promise<void> {
  await pool.query("DELETE FROM fabrica_cliente_apelidos WHERE id = $1", [id]);
}
