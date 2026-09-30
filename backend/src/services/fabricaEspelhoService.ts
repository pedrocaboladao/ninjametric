import { pool } from "../db/pool";
import { listarContasBling } from "./blingContasService";

// Espelho Bling -> site das contas a pagar.
//
// A regra do negocio virou: tudo nasce no Bling (a funcionaria lanca a partir
// da nota fiscal, com historico e favorecido do PIX) e o site espelha. Este
// servico e o espelho.
//
// Tres decisoes que parecem detalhe e nao sao:
//
// 1. `competencia` sai da competencia do Bling, nunca do vencimento. Os dois
//    campos significam coisas diferentes nos dois sistemas: no site a
//    competencia nasce igual ao vencimento, no Bling e a emissao da nota. Uma
//    compra de setembro que vence em outubro cai em meses diferentes de cada
//    lado — e o DRE agrupa por competencia. Espelhar pelo vencimento jogaria
//    R$ 136 mil de setembro pra dentro de outubro.
//
// 2. `custo_fixo` sai da categoria, nunca do padrao. O INSERT da tabela
//    nasce com TRUE, e compra de revenda nao e custo fixo.
//
// 3. Categoria que o espelho nao conhece NAO e adivinhada. Vai pra tabela
//    como NULL (a tela mostra "SEM CATEGORIA") e sai na fila de revisao. O
//    lancamento e manual, entao categoria errada ou vazia vai acontecer — o
//    que nao pode e o erro ficar invisivel. Hoje, das 8 notas espelhadas a
//    mao, 6 estavam sem categoria nenhuma no Bling.

/** 1 = em aberto, 2 = baixada. Mesma convencao do resto do modulo. */
const BAIXADA = 2;

// A categoria do DRE que carrega o CMV como conta a pagar. Ela existe pro DRE
// do Bling fechar e nao representa dinheiro a pagar a fornecedor nenhum:
// espelhar isso criaria uma despesa fantasma no site.
const AJUSTE_DE_DRE = 14745703210;

// Bling -> site. Quase todo par aqui saiu da evidencia, nao de palpite: veio
// dos 325 titulos que setembro e outubro ja tinham conciliados, contando qual
// categoria do site cada categoria do Bling casou. Onde a evidencia se dividiu
// (Licencas/Registros/Taxas caiu em IMOBILIZADO 3x, JURIDICO E MARCAS 2x e
// IMPOSTO 1x) o par foi deixado FORA de proposito — vai pra fila de revisao,
// que e melhor que escolher o mais frequente e errar em silencio.
//
// Os marcados "tautologico" nao tem evidencia porque nao apareceram no
// periodo; entraram porque o nome do Bling e o nome do site sao a mesma coisa.
const MAPA_CATEGORIA: Record<number, string> = {
  14734532157: "REVENDA", // Compras de Mercadorias (121x)
  14734532158: "MATÉRIA-PRIMA", // Materias-primas e Insumos (9x)
  14734532162: "MATÉRIA-PRIMA", // Frete sobre Compras (7x) — o frete da compra
  14734532159: "EMBALAGEM", // Embalagens e Materiais de Envio (30x)
  14743548844: "IMOBILIZADO", // (24x)
  14734532202: "BENEFÍCIOS", // Beneficios VR/VA/Transporte (16x)
  14734532197: "SALÁRIO", // Salarios (15x)
  14734532212: "TARIFAS BANCÁRIAS", // Tarifa pre deposito (8x)
  14734532217: "TARIFAS BANCÁRIAS", // Tarifas Bancarias (6x)
  14745622309: "DIÁRIAS E BÔNUS FORA DA FOLHA", // (7x)
  14734532203: "ADIANTAMENTO", // Ferias/13o/Adiantamentos (6x)
  14734532186: "MANUTENÇÃO PREDIAL", // Condominio e Manutencao Predial (4x)
  14734532231: "RETIRADA DE LUCROS", // Retirada de Socios (4x)
  14745620157: "SEGURANÇA DO TRABALHO", // (4x)
  14745621238: "RATEIO MARINGÁ FULL", // (4x)
  14734532221: "JUROS E MULTAS POR ATRASO", // Juros Pagos (3x)
  14734532161: "MANUTENÇÃO DE MÁQUINAS", // Ferramentas e Manut. de Producao (3x)
  14734532199: "ENCARGOS", // INSS (3x)
  14745620841: "MANUTENÇÃO DE VEÍCULOS", // (3x)
  14734532188: "LUZ", // (3x)
  14734532187: "ÁGUA", // (2x)
  14745620451: "MATERIAL DE EXPEDIÇÃO", // (2x)
  14745620945: "SEGURO E TAXAS DE FINANCIAMENTO", // (2x)
  14743617389: "EMPRÉSTIMO", // Pagamento de emprestimos (2x)
  14734532179: "SISTEMAS E ASSINATURAS", // Plataformas e Assinaturas (2x)
  14734532185: "ALUGUEL", // (2x)
  14734532193: "CONTABILIDADE", // Contabilidade e Servicos Fiscais (2x)
  14734532192: "SEGURANÇA E MONITORAMENTO", // (2x)
  14745621724: "COMBUSTÍVEL", // (1x)
  14734532207: "IMPOSTO", // Impostos e Taxas (1x)
  14734532200: "ENCARGOS", // FGTS — tautologico, irmao do INSS
  14734532204: "RESCISÕES", // tautologico
  14734532191: "LIMPEZA", // Limpeza e Conservacao — tautologico
  14734532222: "JUROS E MULTAS POR ATRASO", // Multas Pagas — tautologico
  14734532223: "TARIFAS BANCÁRIAS", // Tarifas de Boleto/PIX — tautologico
  14734532215: "TARIFAS BANCÁRIAS", // Tarifa cheque — tautologico
  14745638161: "CONSUMO", // tautologico
  14734532226: "CONFRATERNIZAÇÃO E PATROCÍNIO", // Doacoes/Patrocinios — tautologico
};

// Categoria do site que NAO e custo fixo. O resto e. Sai daqui e nao de um
// campo do Bling porque o Bling nao tem esse conceito.
const NAO_E_CUSTO_FIXO = new Set([
  "REVENDA",
  "MATÉRIA-PRIMA",
  "EMBALAGEM",
  "IMOBILIZADO",
  "ADIANTAMENTO",
  "RETIRADA DE LUCROS",
  "DIÁRIAS E BÔNUS FORA DA FOLHA",
  "JUROS E MULTAS POR ATRASO",
  "MANUTENÇÃO PREDIAL",
  "MANUTENÇÃO DE MÁQUINAS",
  "MANUTENÇÃO DE VEÍCULOS",
  "RESCISÕES",
  "CONFRATERNIZAÇÃO E PATROCÍNIO",
  "MATERIAL DE EXPEDIÇÃO",
  "CONSUMO",
]);

export interface TituloEspelhado {
  blingId: number;
  /** O historico do Bling: e ele que vira a descricao da conta no site. */
  historico: string;
  vencimento: string;
  valor: number;
  contraparte: string;
  documento: string;
  categoria: string | null;
  competencia: string;
  pagoNoBling: boolean;
}

export interface Divergencia extends TituloEspelhado {
  contaId: number;
  campos: string[];
  valorNoSite: number;
  vencimentoNoSite: string;
  statusNoSite: string;
}

export interface Orfa {
  contaId: number;
  vencimento: string;
  valor: number;
  contraparte: string | null;
  categoria: string | null;
  status: string;
}

export interface Espelho {
  de: string;
  ate: string;
  simulado: boolean;
  /** Nao existiam no site: viram INSERT. */
  novas: TituloEspelhado[];
  /** Ja existiam sem `bling_id`: so ganham o vinculo, nada mais muda. */
  adotadas: Array<TituloEspelhado & { contaId: number }>;
  /** Vinculadas e com campo diferente. Nunca sobrescritas aqui. */
  divergentes: Divergencia[];
  /** Fila de revisao: categoria vazia no Bling ou fora do mapa. */
  paraRevisar: Array<TituloEspelhado & { categoriaBling: number | null }>;
  /**
   * O fornecedor sobrou nos DOIS lados: mesma compra registrada diferente
   * (parcelamento ou valor). Nada foi inserido — inserir duplicaria o dinheiro.
   */
  revisarFornecedor: TituloEspelhado[];
  /** Contas a pagar do site sem par no Bling — o Bling e que esta incompleto. */
  orfasDoSite: Orfa[];
  ignoradas: number;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const cent = (v: unknown) => Math.round(Number(v ?? 0) * 100);

/** Normaliza nome de fornecedor pra comparar: "EXPADER" casa "EXPADER LTDA". */
function apelido(nome: string): string {
  return (nome || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(LTDA|ME|EPP|SA|S\/A|EIRELI|CIA|COM|IND|E)\b/g, "")
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
}

/** Só os dígitos, sem zero à esquerda: "007790" casa "7790" e "353289/1". */
function chaveDoc(doc: string): string {
  return (doc || "").replace(/\D/g, "").replace(/^0+/, "");
}

function categoriaDoSite(categoriaId: number | null): string | null {
  if (!categoriaId) return null;
  return MAPA_CATEGORIA[categoriaId] ?? null;
}

export async function espelharContasDoBling(
  de: string,
  ate: string,
  simular = true
): Promise<Espelho> {
  if (!ISO.test(de) || !ISO.test(ate)) throw new Error("Informe de/ate como AAAA-MM-DD.");
  if (de > ate) throw new Error("O periodo esta invertido.");

  // Uma chamada so: `listarContasBling` pagina o Bling com throttle de 3/s e
  // um mes leva minutos. Chamar duas vezes pra contar as ignoradas dobraria a
  // espera por um numero que sai de uma subtracao.
  const doBling = await listarContasBling(de, ate);
  const titulos = doBling.filter((t) => Number(t.categoriaId) !== AJUSTE_DE_DRE);
  const ignoradas = doBling.length - titulos.length;

  // A janela do site e mais larga que a do Bling de proposito: a adocao casa
  // por documento, e a parcela 2/3 de uma nota pode vencer fora do periodo.
  const { rows: contas } = await pool.query<{
    id: number;
    valor: string;
    vencimento: Date;
    status: string;
    contraparte: string | null;
    categoria: string | null;
    documento: string | null;
    bling_id: string | null;
  }>(
    `SELECT id, valor, vencimento, status, contraparte, categoria, documento, bling_id
       FROM fabrica_contas
      WHERE tipo = 'pagar'
        AND provisao = FALSE
        -- cancelada nao entra: adotar uma conta morta com um titulo vivo do
        -- Bling esconderia a despesa dos dois lados
        AND status <> 'cancelado'
        AND vencimento BETWEEN $1::date - INTERVAL '45 days'
                           AND $2::date + INTERVAL '45 days'`,
    [de, ate]
  );

  const dia = (d: Date) => d.toISOString().slice(0, 10);
  const porBlingId = new Map<string, (typeof contas)[number]>();
  const livres: typeof contas = [];
  for (const c of contas) {
    if (c.bling_id) porBlingId.set(String(c.bling_id), c);
    else livres.push(c);
  }

  const novas: Espelho["novas"] = [];
  const adotadas: Espelho["adotadas"] = [];
  const divergentes: Espelho["divergentes"] = [];
  const paraRevisar: Espelho["paraRevisar"] = [];
  const revisarFornecedor: Espelho["revisarFornecedor"] = [];
  // titulos do Bling que nao casaram 1-pra-1: a segunda passada decide o
  // destino deles, e ela nao pode rodar antes de todas as adocoes terminarem
  const pendentes: TituloEspelhado[] = [];
  const adotados = new Set<number>();

  const noPeriodo = (c: (typeof contas)[number]) => {
    const d = dia(c.vencimento);
    return d >= de && d <= ate;
  };
  const distanciaEmDias = (a: string, b: string) =>
    Math.abs(Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000;

  for (const t of titulos) {
    const categoria = categoriaDoSite(t.categoriaId);
    const base: TituloEspelhado = {
      blingId: t.id,
      vencimento: t.vencimento,
      valor: t.valor,
      contraparte: t.contato,
      documento: t.numeroDocumento || "",
      historico: t.historico || "",
      categoria,
      // sem competencia no Bling o vencimento responde, que e o que o site faz
      competencia: t.competencia ?? t.vencimento,
      pagoNoBling: Number(t.situacao) === BAIXADA,
    };
    if (!categoria) paraRevisar.push({ ...base, categoriaBling: t.categoriaId });

    const jaVinculada = porBlingId.get(String(t.id));
    if (jaVinculada) {
      const campos: string[] = [];
      if (cent(jaVinculada.valor) !== cent(t.valor)) campos.push("valor");
      if (dia(jaVinculada.vencimento) !== t.vencimento) campos.push("vencimento");
      const pagoNoSite = jaVinculada.status === "pago";
      if (pagoNoSite !== base.pagoNoBling) campos.push("baixa");
      if (campos.length)
        divergentes.push({
          ...base,
          contaId: jaVinculada.id,
          campos,
          valorNoSite: Number(jaVinculada.valor),
          vencimentoNoSite: dia(jaVinculada.vencimento),
          statusNoSite: jaVinculada.status,
        });
      continue;
    }

    // Adocao: a conta ja esta no site, so nao sabe que veio do Bling. E o caso
    // de todo o passado — 325 titulos de setembro e outubro. Inserir seria
    // duplicar. O documento manda quando os dois lados tem um, porque
    // valor+vencimento empata (os dois REVGOLD de 28.360,00 em 27/09 se
    // distinguem so pelo 700296 e 700297).
    const docBling = chaveDoc(t.numeroDocumento);
    const candidatas = livres.filter(
      (c) => !adotados.has(c.id) && cent(c.valor) === cent(t.valor)
    );
    const alvo =
      (docBling && candidatas.find((c) => chaveDoc(c.documento ?? "") === docBling)) ||
      candidatas.find(
        (c) =>
          dia(c.vencimento) === t.vencimento &&
          apelido(c.contraparte ?? "") === apelido(t.contato)
      ) ||
      candidatas.find((c) => dia(c.vencimento) === t.vencimento) ||
      // ultimo recurso: mesmo valor e mesmo fornecedor com o vencimento a
      // poucos dias. E o caso mais comum de setembro — REVGOLD de 48.044,05
      // em 02/09 aqui e 04/09 la, Maringa Full com 2 dias, Mestre e Jacob com
      // 1. So depois que todo casamento exato ja consumiu suas candidatas, e
      // com janela curta: dois titulos iguais do mesmo fornecedor no mesmo mes
      // existem (REVCOLLOR de 28.000,00 duas vezes em outubro), e eles casam
      // exato antes de chegar aqui.
      candidatas.find(
        (c) =>
          apelido(c.contraparte ?? "") === apelido(t.contato) &&
          distanciaEmDias(dia(c.vencimento), t.vencimento) <= 5
      );

    if (alvo) {
      adotados.add(alvo.id);
      adotadas.push({ ...base, contaId: alvo.id });
      if (!simular)
        await pool.query(`UPDATE fabrica_contas SET bling_id = $2 WHERE id = $1`, [
          alvo.id,
          t.id,
        ]);
      continue;
    }

    pendentes.push(base);
  }

  // Segunda passada, por fornecedor — e ela existe pra nao duplicar dinheiro.
  //
  // Titulo do Bling que nao casou 1-pra-1 quase nunca e conta nova: e a mesma
  // compra registrada diferente. Oswaldo Cruz tem UM titulo de R$ 306.240,00 no
  // Bling e DOIS no site (150.000,00 + 156.240,00); EXPADER vem em 2 parcelas
  // aqui e 4 la; I. A. Tavares e um titulo de cada lado com R$ 3.000,00 de
  // diferenca. Em nenhum desses o valor individual casa — e inserir o do Bling
  // faria o site contar a compra duas vezes.
  //
  // Entao a decisao nao e por titulo, e por fornecedor na janela:
  //   sobra nos DOIS lados  -> ninguem insere nada, vai pra revisao
  //   sobra so no Bling     -> e conta que falta aqui de verdade: INSERT
  //   sobra so no site      -> falta LA (foi como as diarias apareceram)
  const sobraDoSite = livres.filter((c) => !adotados.has(c.id) && noPeriodo(c));
  const sobraPorFornecedor = new Set(sobraDoSite.map((c) => apelido(c.contraparte ?? "")));

  for (const p of pendentes) {
    if (sobraPorFornecedor.has(apelido(p.contraparte))) {
      revisarFornecedor.push(p);
      continue;
    }
    novas.push(p);
    if (!simular) {
      await pool.query(
        `INSERT INTO fabrica_contas
           (tipo, descricao, categoria, contraparte, valor, vencimento, status,
            data_pagamento, custo_fixo, observacao, documento, provisao,
            competencia, bling_id)
         VALUES ('pagar', $1, $2, $3, $4, $5::date, $6, NULL, $7, $8, $9, FALSE,
                 $10::date, $11)
         ON CONFLICT (bling_id) WHERE bling_id IS NOT NULL DO NOTHING`,
        [
          p.historico || p.documento || p.contraparte || "titulo do Bling",
          p.categoria,
          p.contraparte || null,
          p.valor,
          p.vencimento,
          // a baixa vem do Bling, mas a data dela nao: o endpoint de listagem
          // nao traz `dataPagamento`. Quem tem a data e a conciliacao do
          // extrato — deixar NULL e melhor que inventar o vencimento.
          p.pagoNoBling ? "pago" : "pendente",
          p.categoria ? !NAO_E_CUSTO_FIXO.has(p.categoria) : false,
          `Espelhado do Bling (titulo ${p.blingId}).`,
          p.documento || null,
          p.competencia,
          p.blingId,
        ]
      );
    }
  }

  // Sobrou no site e o fornecedor nao tem sobra no Bling: se o Bling e o ponto
  // de partida, essa conta esta faltando LA. Foi assim que as duas diarias do
  // Douglas e do Rodrigo apareceram. O fornecedor que sobrou dos dois lados
  // fica de fora daqui — ele ja esta em `revisarFornecedor`, e listar nos dois
  // lugares faria a mesma divergencia parecer duas.
  const emRevisao = new Set(revisarFornecedor.map((p) => apelido(p.contraparte)));
  const orfasDoSite: Orfa[] = sobraDoSite
    .filter((c) => !emRevisao.has(apelido(c.contraparte ?? "")))
    .map((c) => ({
      contaId: c.id,
      vencimento: dia(c.vencimento),
      valor: Number(c.valor),
      contraparte: c.contraparte,
      categoria: c.categoria,
      status: c.status,
    }));

  return {
    de,
    ate,
    simulado: simular,
    novas,
    adotadas,
    divergentes,
    paraRevisar,
    revisarFornecedor,
    orfasDoSite,
    ignoradas,
  };
}
