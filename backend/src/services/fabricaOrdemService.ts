import { pool } from "../db/pool";

// Ordem de fabricação: a folha que vai pro chão de fábrica.
//
// Escolhe a fórmula, digita o peso do lote e sai o passo a passo na ordem
// exata de fazer, com a massa de cada insumo já calculada e os tempos de
// espera no meio.
//
// Fórmula de cor imprime a base junto. Um lote de Emborrachado Areia não
// começa com "adicione 99,42% de Base A" — começa carregando o tanque com
// água, dispersando a malha, esperando a fineza abrir. Só depois vem o
// pigmento. A folha precisa contar essa história inteira, então o passo de
// sub-fórmula expande no roteiro dela.

export interface PassoImpressao {
  // 0 = fórmula pedida, 1 = base expandida dentro dela
  nivel: number;
  origem: string;
  tipo: "cabecalho" | "adicao" | "instrucao";
  numero: string | null;
  codigo: string | null;
  descricao: string;
  percentual: number | null;
  massaKg: number | null;
  etapa: string | null;
}

export interface LinhaQc {
  teste: string;
  especificacao: string | null;
}

export interface OrdemFabricacao {
  formulaId: number;
  formulaNome: string;
  pesoKg: number;
  passos: PassoImpressao[];
  qc: LinhaQc[];
  // avisos que a folha mostra em vez de esconder: roteiro faltando, soma
  // diferente de 100, roteiro que discorda da fórmula
  avisos: string[];
}

interface PassoBruto {
  formula_id: number;
  ordem: number;
  materia_prima_id: number | null;
  sub_formula_id: number | null;
  percentual: string | null;
  codigo: string | null;
  etapa: string | null;
  instrucao: string | null;
  nome_materia: string | null;
  nome_sub: string | null;
}

async function passosDe(formulaId: number): Promise<PassoBruto[]> {
  const { rows } = await pool.query<PassoBruto>(
    `SELECT p.formula_id, p.ordem, p.materia_prima_id, p.sub_formula_id, p.percentual,
            p.codigo, p.etapa, p.instrucao,
            mp.nome AS nome_materia, f.nome AS nome_sub
     FROM fabrica_roteiro_passos p
     LEFT JOIN materias_primas mp ON mp.id = p.materia_prima_id
     LEFT JOIN formulas f ON f.id = p.sub_formula_id
     WHERE p.formula_id = $1
     ORDER BY p.ordem, p.id`,
    [formulaId]
  );
  return rows;
}

// Sem roteiro cadastrado, monta um provisório com os itens da fórmula. A ordem
// sai como o banco devolveu e não tem tempo de espera — mas uma folha com as
// massas certas e sem instrução ainda serve, e a alternativa seria a tela
// dizer "não dá pra imprimir" pra quase todas as fórmulas no primeiro dia.
async function passosDaFormula(formulaId: number): Promise<PassoBruto[]> {
  const { rows } = await pool.query<PassoBruto>(
    `SELECT i.formula_id, i.id AS ordem, i.materia_prima_id, i.sub_formula_id,
            i.percentual, NULL AS codigo, NULL AS etapa, NULL AS instrucao,
            mp.nome AS nome_materia, f.nome AS nome_sub
     FROM formula_itens i
     LEFT JOIN materias_primas mp ON mp.id = i.materia_prima_id
     LEFT JOIN formulas f ON f.id = i.sub_formula_id
     WHERE i.formula_id = $1
     ORDER BY i.id`,
    [formulaId]
  );
  return rows;
}

async function qcDe(formulaId: number): Promise<LinhaQc[]> {
  const { rows } = await pool.query<{ teste: string; especificacao: string | null }>(
    `SELECT teste, especificacao FROM fabrica_roteiro_qc
     WHERE formula_id = $1 ORDER BY ordem, id`,
    [formulaId]
  );
  return rows.map((r) => ({ teste: r.teste, especificacao: r.especificacao }));
}

export async function temRoteiro(formulaId: number): Promise<boolean> {
  const { rows } = await pool.query<{ n: string }>(
    "SELECT COUNT(*) AS n FROM fabrica_roteiro_passos WHERE formula_id = $1",
    [formulaId]
  );
  return Number(rows[0].n) > 0;
}

export async function montarOrdem(
  formulaId: number,
  pesoKg: number
): Promise<OrdemFabricacao | null> {
  const { rows: fRows } = await pool.query<{ id: number; nome: string; peso_lote_kg: string }>(
    "SELECT id, nome, peso_lote_kg FROM formulas WHERE id = $1",
    [formulaId]
  );
  if (!fRows.length) return null;
  const formula = fRows[0];
  const peso = pesoKg > 0 ? pesoKg : Number(formula.peso_lote_kg) || 1;

  const avisos: string[] = [];
  const passos: PassoImpressao[] = [];
  let numero = 0;

  // emCalculo trava ciclo: fórmula que referenciasse a si mesma, direta ou
  // indiretamente, faria a impressão rodar pra sempre
  async function expandir(
    id: number,
    nome: string,
    massa: number,
    nivel: number,
    emCalculo: Set<number>
  ): Promise<void> {
    if (emCalculo.has(id)) {
      avisos.push(`${nome} referencia ela mesma — parei de expandir aqui.`);
      return;
    }
    emCalculo.add(id);

    const proprio = await passosDe(id);
    const brutos = proprio.length ? proprio : await passosDaFormula(id);
    if (!proprio.length) {
      avisos.push(
        `${nome} ainda não tem roteiro: os itens saíram na ordem do cadastro, sem os tempos de espera.`
      );
    }

    if (nivel > 0) {
      passos.push({
        nivel,
        origem: nome,
        tipo: "cabecalho",
        numero: null,
        codigo: null,
        descricao: `${nome} — ${massa.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`,
        percentual: null,
        massaKg: massa,
        etapa: null,
      });
    }

    let soma = 0;
    for (const b of brutos) {
      const pct = b.percentual === null ? null : Number(b.percentual);

      if (b.materia_prima_id === null && b.sub_formula_id === null) {
        passos.push({
          nivel,
          origem: nome,
          tipo: "instrucao",
          numero: null,
          codigo: null,
          descricao: b.instrucao ?? b.etapa ?? "",
          percentual: null,
          massaKg: null,
          etapa: b.etapa,
        });
        continue;
      }

      soma += pct ?? 0;
      const massaItem = ((pct ?? 0) * massa) / 100;

      if (b.sub_formula_id !== null) {
        await expandir(
          b.sub_formula_id,
          b.nome_sub ?? `Fórmula ${b.sub_formula_id}`,
          massaItem,
          nivel + 1,
          emCalculo
        );
        continue;
      }

      numero += 1;
      passos.push({
        nivel,
        origem: nome,
        tipo: "adicao",
        numero: String(numero).padStart(2, "0"),
        codigo: b.codigo,
        descricao: b.nome_materia ?? `Matéria-prima ${b.materia_prima_id}`,
        percentual: pct,
        massaKg: massaItem,
        etapa: b.etapa,
      });
    }

    // 0,05 de tolerância: percentual com 3 casas acumula arredondamento, e
    // avisar de uma diferença de milésimo seria ruído que ninguém lê
    if (Math.abs(soma - 100) > 0.05) {
      avisos.push(`${nome} soma ${soma.toFixed(2)}% em vez de 100%.`);
    }

    emCalculo.delete(id);
  }

  await expandir(formula.id, formula.nome, peso, 0, new Set());

  return {
    formulaId: formula.id,
    formulaNome: formula.nome,
    pesoKg: peso,
    passos,
    qc: await qcDe(formula.id),
    avisos,
  };
}

// --- edição do roteiro -------------------------------------------------------

export interface PassoEntrada {
  materiaPrimaId?: number | null;
  subFormulaId?: number | null;
  percentual?: number | null;
  codigo?: string | null;
  etapa?: string | null;
  instrucao?: string | null;
}

// Grava o roteiro inteiro de uma vez. A ordem é a posição no array — assim
// mover um passo é reordenar a lista na tela, sem renumerar nada à mão.
export async function salvarRoteiro(
  formulaId: number,
  passos: PassoEntrada[],
  qc: LinhaQc[]
): Promise<void> {
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    await cliente.query("DELETE FROM fabrica_roteiro_passos WHERE formula_id = $1", [formulaId]);
    let ordem = 0;
    for (const p of passos) {
      await cliente.query(
        `INSERT INTO fabrica_roteiro_passos
           (formula_id, ordem, materia_prima_id, sub_formula_id, percentual, codigo, etapa, instrucao)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          formulaId,
          ordem++,
          p.materiaPrimaId ?? null,
          p.subFormulaId ?? null,
          p.percentual ?? null,
          p.codigo ?? null,
          p.etapa ?? null,
          p.instrucao ?? null,
        ]
      );
    }
    await cliente.query("DELETE FROM fabrica_roteiro_qc WHERE formula_id = $1", [formulaId]);
    let ordemQc = 0;
    for (const linha of qc) {
      await cliente.query(
        "INSERT INTO fabrica_roteiro_qc (formula_id, ordem, teste, especificacao) VALUES ($1,$2,$3,$4)",
        [formulaId, ordemQc++, linha.teste, linha.especificacao]
      );
    }
    await cliente.query("COMMIT");
  } catch (err) {
    await cliente.query("ROLLBACK");
    throw err;
  } finally {
    cliente.release();
  }
}

// Quais fórmulas já têm roteiro — a tela marca as que faltam.
export async function formulasComRoteiro(): Promise<
  { formulaId: number; nome: string; passos: number }[]
> {
  const { rows } = await pool.query<{ id: number; nome: string; passos: string }>(
    `SELECT f.id, f.nome,
            (SELECT COUNT(*) FROM fabrica_roteiro_passos p WHERE p.formula_id = f.id) AS passos
     FROM formulas f ORDER BY f.nome`
  );
  return rows.map((r) => ({ formulaId: r.id, nome: r.nome, passos: Number(r.passos) }));
}

// --- importar colando da planilha --------------------------------------------
//
// O Excel copia como TSV: uma linha por celula-linha, colunas separadas por
// tab. Entao da pra selecionar as linhas da ordem de producao na planilha,
// Ctrl+C, e colar aqui — sem digitar passo nenhum, e sem eu inventar um
// formato que so eu sei escrever.
//
// Linha com codigo, nome e percentual vira passo de ADICAO.
// Linha so com texto na primeira coluna vira INSTRUCAO ("deixar em dispersao
// de 40 min a 1 hora"), que e exatamente como a planilha ja guarda os tempos.

function normalizar(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

interface Achado {
  id: number;
  nome: string;
}

// Casa o nome da planilha com a materia-prima cadastrada. Tenta igualdade
// primeiro; so depois aceita que um contenha o outro, porque o cadastro usa
// nome longo ("BACTERICIDA / FORTBIO BT 1001") e a planilha as vezes usa curto.
// Se dois cadastros servirem, nao escolhe — devolve nulo e a tela mostra a
// linha pro operador resolver. Chutar aqui poria a materia errada na formula.
function casar(nome: string, cadastro: Achado[]): { id: number | null; ambiguo: boolean } {
  const alvo = normalizar(nome);
  if (!alvo) return { id: null, ambiguo: false };

  const exatos = cadastro.filter((c) => normalizar(c.nome) === alvo);
  if (exatos.length === 1) return { id: exatos[0].id, ambiguo: false };
  if (exatos.length > 1) return { id: null, ambiguo: true };

  const parciais = cadastro.filter((c) => {
    const n = normalizar(c.nome);
    return n.includes(alvo) || alvo.includes(n);
  });
  if (parciais.length === 1) return { id: parciais[0].id, ambiguo: false };
  return { id: null, ambiguo: parciais.length > 1 };
}

export interface ResultadoImportacao {
  passos: number;
  instrucoes: number;
  qc: number;
  naoEncontrados: string[];
  ambiguos: string[];
  somaPercentual: number;
}

export async function importarRoteiro(
  formulaId: number,
  texto: string,
  textoQc: string
): Promise<ResultadoImportacao> {
  const { rows } = await pool.query<Achado>("SELECT id, nome FROM materias_primas");
  const subs = await pool.query<Achado>("SELECT id, nome FROM formulas WHERE id <> $1", [formulaId]);

  const passos: PassoEntrada[] = [];
  const naoEncontrados: string[] = [];
  const ambiguos: string[] = [];
  let soma = 0;
  let instrucoes = 0;
  let adicoes = 0;

  for (const linhaBruta of texto.split(/\r?\n/)) {
    const linha = linhaBruta.replace(/\t+$/, "");
    if (!linha.trim()) continue;
    const col = linha.split("\t").map((c) => c.trim());

    // percentual pode vir com virgula decimal do Excel em pt-BR
    const pct = col.length >= 4 ? Number(col[3].replace(",", ".")) : NaN;

    if (col.length >= 4 && Number.isFinite(pct) && col[2]) {
      const nome = col[2];
      const achado = casar(nome, rows);
      const achadoSub = achado.id === null ? casar(nome, subs.rows) : { id: null, ambiguo: false };

      if (achado.id === null && achadoSub.id === null) {
        (achado.ambiguo || achadoSub.ambiguo ? ambiguos : naoEncontrados).push(nome);
        continue;
      }
      soma += pct;
      adicoes += 1;
      passos.push({
        materiaPrimaId: achado.id,
        subFormulaId: achado.id === null ? achadoSub.id : null,
        percentual: pct,
        codigo: col[1] || null,
        etapa: null,
        instrucao: null,
      });
      continue;
    }

    // sobrou texto: e a instrucao ou o nome da fase
    const instrucao = col.find((c) => c.length > 2) ?? "";
    if (!instrucao) continue;
    instrucoes += 1;
    passos.push({
      materiaPrimaId: null,
      subFormulaId: null,
      percentual: null,
      codigo: null,
      etapa: null,
      instrucao,
    });
  }

  const qc: LinhaQc[] = [];
  for (const linhaBruta of (textoQc || "").split(/\r?\n/)) {
    if (!linhaBruta.trim()) continue;
    const col = linhaBruta.split("\t").map((c) => c.trim());
    const teste = col[0];
    if (!teste) continue;
    qc.push({ teste, especificacao: col.slice(1).find((c) => c) ?? null });
  }

  if (!adicoes) throw new Error("Nenhum passo de adição reconhecido — confira o que foi colado.");
  await salvarRoteiro(formulaId, passos, qc);

  return {
    passos: adicoes,
    instrucoes,
    qc: qc.length,
    naoEncontrados,
    ambiguos,
    somaPercentual: soma,
  };
}
