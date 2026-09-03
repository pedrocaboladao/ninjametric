import axios from "axios";
import { pool } from "../db/pool";
import { tokenValido } from "./blingAuth";

// Confere as contas a pagar do site contra o Bling.
//
// O ERP é quem manda: a nota de compra nasce lá. O site tem cópia porque é dela
// que sai o custo do DRE — e cópia que ninguém confere é cópia que envelhece.
//
// Só lê. Não grava nada no Bling nem no site: a conferência aponta a diferença
// e quem decide o que fazer é o Hudson. Acertar sozinho, num lugar onde o
// número vira custo, é como a receita fantasma de agosto começou.

const BASE = "https://api.bling.com.br/Api/v3";
const POR_PAGINA = 100;
// mesmo teto de 3 chamadas por segundo do resto da API
const ESPACO_MS = 350;
const TENTATIVAS = 4;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
let proximaLivre = 0;

async function vez(): Promise<void> {
  const agora = Date.now();
  const quando = Math.max(agora, proximaLivre);
  proximaLivre = quando + ESPACO_MS;
  if (quando > agora) await dormir(quando - agora);
}

async function chamar<T>(caminho: string, params?: Record<string, unknown>): Promise<T> {
  let espera = 2000;
  for (let tentativa = 1; ; tentativa++) {
    await vez();
    const token = await tokenValido();
    try {
      const { data } = await axios.get<T>(`${BASE}${caminho}`, {
        params,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        timeout: 30000,
      });
      return data;
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status === 429 && tentativa < TENTATIVAS) {
        await dormir(espera);
        espera *= 2;
        continue;
      }
      if (axios.isAxiosError(err) && err.response) {
        const d = err.response.data as unknown;
        const t = typeof d === "string" ? d : JSON.stringify(d);
        throw new Error(`Bling ${err.response.status}: ${t.slice(0, 300)}`);
      }
      throw err;
    }
  }
}

interface ContaBling {
  id: number;
  situacao?: number | string;
  vencimento?: string;
  valor?: number;
  saldo?: number;
  numeroDocumento?: string;
  historico?: string;
  // Vem so o id. O nome nunca vem, nem na listagem nem no detalhe — quem quiser
  // saber de quem e a conta tem que ir buscar o contato.
  contato?: { id?: number; nome?: string };
  // idem, e na Fabrica vem sempre {id: 0}: o ERP nao classifica conta a pagar.
  // Quem classifica e o site, e por isso o DRE sai de la e nao daqui.
  categoria?: { id?: number; descricao?: string };
  portador?: { id?: number; descricao?: string };
}

export interface ContaConferida {
  documento: string;
  contraparte: string;
  vencimento: string;
  valor: number;
  // como cada lado classifica a conta. Sem isso a lista de divergencia e um
  // monte de linha solta — com isso da pra ver que "so no Bling" e quase toda
  // despesa miuda que nunca precisou existir no site.
  categoria: string;
  // o que difere entre os dois lados, escrito em português
  diferenca?: string;
  blingId?: number;
  siteId?: number;
  // O que o Bling diz, pra tela poder trazer sem uma segunda consulta.
  //
  // Na conferencia de contas a pagar o Bling e a referencia: o site cria a
  // recorrente como previsao, repetindo o valor do mes anterior, e quem corrige
  // quando o boleto chega e a funcionaria, no Bling.
  blingValor?: number;
  blingVencimento?: string;
  blingContraparte?: string;
  // como os dois foram casados: por documento, ou por valor e data proximos
  parEncontradoPor?: "documento" | "valor";
}

export interface ConferenciaContas {
  de: string;
  ate: string;
  noBling: number;
  noSite: number;
  conferem: number;
  soNoBling: ContaConferida[];
  soNoSite: ContaConferida[];
  divergentes: ContaConferida[];
}

// Todas as contas do período, com o detalhe de cada uma.
//
// Duas armadilhas do Bling aqui, e as duas silenciosas:
//
//   o filtro de data e ignorado    pedindo 01/08 a 31/08 ele devolveu contas
//                                  vencendo em 15/07. Nao da erro, nao avisa —
//                                  so devolve outra coisa. Entao o recorte e
//                                  feito aqui, depois de baixar.
//
//   a listagem vem sem os campos   `historico`, `numeroDocumento` e o nome do
//   que identificam a conta        contato so existem no GET de uma conta so.
//                                  Na listagem vem tudo vazio, e comparar assim
//                                  deu 0 de 159 — o mesmo que o `gtin` faz nos
//                                  produtos.
//
// Por isso o detalhe e buscado uma a uma. A 3 chamadas por segundo, um mes sai
// em menos de um minuto; e conferencia que alguem roda de vez em quando, nao
// tela que abre toda hora.
//
// Sem filtro de situacao de proposito: conta ja paga sai do filtro "em aberto"
// e apareceria como buraco no site — o contrario do que a conferencia procura.
async function baixarDoBling(de: string, ate: string): Promise<ContaBling[]> {
  const bruto: ContaBling[] = [];
  for (let pagina = 1; pagina <= 60; pagina++) {
    const r = await chamar<{ data?: ContaBling[] }>("/contas/pagar", {
      pagina,
      limite: POR_PAGINA,
    });
    const lote = r.data ?? [];
    bruto.push(...lote);
    if (lote.length < POR_PAGINA) break;
  }

  const noPeriodo = bruto.filter((c) => {
    const v = dia(c.vencimento);
    return v >= de && v <= ate;
  });

  // Nome do fornecedor: uma chamada por contato, nao por conta.
  //
  // Sao dezenas de contas pra meia duzia de fornecedores; buscar por conta
  // gastaria o teto de 3 por segundo a toa e demoraria minutos a mais.
  const nomePorContato = new Map<number, string>();

  const contas: ContaBling[] = [];
  for (const c of noPeriodo) {
    try {
      const d = await chamar<{ data?: ContaBling }>(`/contas/pagar/${c.id}`);
      const det: Partial<ContaBling> = d.data ?? {};
      // O detalhe completa, nao substitui.
      //
      // Espalhar o detalhe por cima trocava o vencimento por outra data — conta
      // filtrada como de agosto voltava mostrando julho. Valor e vencimento
      // ficam os da listagem, que e o que a tela do Bling mostra e o que o
      // recorte de data usou. Do detalhe vem so o que identifica a conta.
      const idContato = det.contato?.id ?? c.contato?.id;
      let nome = idContato ? nomePorContato.get(idContato) : undefined;
      if (idContato && nome === undefined) {
        try {
          const ct = await chamar<{ data?: { nome?: string } }>(`/contatos/${idContato}`);
          nome = ct.data?.nome ?? "";
        } catch {
          nome = "";
        }
        nomePorContato.set(idContato, nome);
      }
      contas.push({
        ...c,
        historico: det.historico ?? c.historico,
        numeroDocumento: det.numeroDocumento ?? c.numeroDocumento,
        contato: { id: idContato, nome: nome || undefined },
        categoria: det.categoria ?? c.categoria,
      });
    } catch {
      // detalhe que nao veio nao some da conferencia: entra com o que a
      // listagem deu e cai em "so no Bling", que e onde alguem vai olhar
      contas.push(c);
    }
  }
  return contas;
}

// O número do documento é a chave. No Bling da Fábrica ele vem no histórico —
// "700296" — e às vezes em numeroDocumento; o site guarda em `documento`.
function chave(...candidatos: Array<string | null | undefined>): string | null {
  for (const c of candidatos) {
    const t = String(c ?? "").trim();
    if (/^\d{4,}$/.test(t)) return t;
  }
  return null;
}

const dinheiro = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;
const dia = (v: unknown) => String(v ?? "").slice(0, 10);

interface LinhaSite {
  id: number;
  documento: string | null;
  descricao: string;
  contraparte: string | null;
  categoria: string | null;
  valor: string;
  vencimento: string;
}

export async function conferirContasPagar(de: string, ate: string): Promise<ConferenciaContas> {
  const [bling, { rows: site }, plano] = await Promise.all([
    baixarDoBling(de, ate),
    pool.query<LinhaSite>(
      `SELECT id, documento, descricao, contraparte, categoria, valor, vencimento::text AS vencimento
         FROM fabrica_contas
        WHERE tipo = 'pagar' AND vencimento BETWEEN $1::date AND $2::date`,
      [de, ate]
    ),
    // o plano de contas do Bling, pra traduzir o id que vem na conta.
    // Falhou? segue sem: a conferencia vale mesmo sem o nome da categoria.
    listarCategoriasBling().catch(() => [] as CategoriaBling[]),
  ]);
  const nomeDaCategoria = new Map(plano.map((c) => [Number(c.id), c.descricao]));

  // indexa o site pelo documento; o que não tem número entra por
  // contraparte + vencimento + valor, que é o que sobra pra identificar a conta
  // Lista, nao um por chave. Quatro vales de R$ 250,00 no mesmo dia com a
  // mesma contraparte dao a mesma chave, e um Map so guardava o ultimo: os
  // outros tres viravam inalcancaveis, e cada conta do Bling com aquela chave
  // casava com a MESMA linha do site, de novo e de novo. Todas contadas como
  // "conferem".
  //
  // O estrago nao e cosmetico: a conferencia dizia que conta batia sem nunca
  // ter olhado pra ela, e as linhas de verdade apareciam como orfas do lado do
  // site. Em setembro/2026 tres contas do Bling casaram com o vale do Ricardo.
  const porChave = new Map<string, LinhaSite[]>();
  const porFato = new Map<string, LinhaSite[]>();
  const empilhar = (m: Map<string, LinhaSite[]>, k: string, s: LinhaSite) => {
    const lista = m.get(k);
    if (lista) lista.push(s);
    else m.set(k, [s]);
  };
  for (const s of site) {
    const k = chave(s.documento, s.descricao);
    if (k) empilhar(porChave, k, s);
    empilhar(
      porFato,
      `${(s.contraparte ?? "").toUpperCase()}|${dia(s.vencimento)}|${dinheiro(s.valor)}`,
      s
    );
  }

  const soNoBling: ContaConferida[] = [];
  const divergentes: ContaConferida[] = [];
  const vistos = new Set<number>();
  let conferem = 0;

  for (const b of bling) {
    const nome = b.contato?.nome ?? "";
    const venc = dia(b.vencimento);
    const valor = dinheiro(b.valor);
    const k = chave(b.numeroDocumento, b.historico);
    // Pega a primeira que ainda nao foi usada. Sem isso a mesma linha do site
    // era entregue a varias contas do Bling.
    const livre = (lista: LinhaSite[] | undefined) =>
      lista?.find((s) => !vistos.has(s.id));
    const achado =
      (k ? livre(porChave.get(k)) : undefined) ??
      livre(porFato.get(`${nome.toUpperCase()}|${venc}|${valor}`));
    const linha: ContaConferida = {
      documento: k ?? b.historico ?? String(b.id),
      contraparte: nome,
      vencimento: venc,
      valor,
      // O detalhe da conta traz `categoria: {id}` e **nunca** a descricao. Ler
      // so `descricao` fazia conta ja classificada aparecer como se nao fosse:
      // caia no historico e a conferencia dizia "HONORARIOS CONTABEIS" depois
      // de a categoria ter sido gravada certa. Por isso o nome vem do plano de
      // contas, pelo id.
      //
      // Sem categoria de verdade sobra o historico, que na pratica e onde a
      // fabrica escreve tanto o numero da nota ("700296") quanto o tipo do
      // gasto ("EMBALAGEM").
      categoria:
        nomeDaCategoria.get(Number(b.categoria?.id ?? 0)) ||
        b.categoria?.descricao?.trim() ||
        (k ? "nota com numero" : (b.historico ?? "").trim() || "sem historico"),
      blingId: b.id,
      blingValor: valor,
      blingVencimento: venc,
      blingContraparte: nome,
    };
    if (!achado) {
      soNoBling.push(linha);
      continue;
    }
    vistos.add(achado.id);
    const problemas: string[] = [];
    if (dinheiro(achado.valor) !== valor)
      problemas.push(`valor: Bling ${valor} × site ${dinheiro(achado.valor)}`);
    if (dia(achado.vencimento) !== venc)
      problemas.push(`vencimento: Bling ${venc} × site ${dia(achado.vencimento)}`);
    if (problemas.length) {
      divergentes.push({
        ...linha,
        siteId: achado.id,
        diferenca: problemas.join("; "),
        parEncontradoPor: "documento",
      });
    } else {
      conferem++;
    }
  }

  const orfaosDoSite = site.filter((s) => !vistos.has(s.id));

  // Segunda passada: a mesma conta com nome diferente dos dois lados.
  //
  // O casamento acima exige numero de documento, ou contraparte + vencimento +
  // valor idênticos. Quando o Bling chama "IPTU" e o site chama "PREFEITURA DE
  // MARINGÁ", ou quando o valor mudou porque o site tinha só a previsão, a
  // mesma conta aparecia nos dois órfãos como se fossem duas — em setembro/2026
  // foram 8 assim, mais a folha inteira.
  //
  // Aqui elas se reencontram pelo que sobra: valor igual em datas próximas, ou
  // contraparte parecida no mesmo mês. Não vira "confere": vira divergente com
  // o valor do Bling do lado, que é o que a tela usa pra corrigir.
  const JANELA_DIAS = 25;
  const emDias = (a: string, b: string) =>
    Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

  // Nome comparado inteiro, sem acento e sem pontuacao. Comparar so a primeira
  // palavra parecia esperto e casou VALE TRANSPORTE com VALE ALIMENTACAO: as
  // duas comecam com "VALE". O botao teria oferecido trocar 250,00 por 324,80.
  const nome = (t: string) =>
    (t ?? "")
      .toUpperCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Z0-9]+/g, " ")
      .trim();

  const usados = new Set<number>();
  const casar = (
    combina: (s: (typeof orfaosDoSite)[number], b: ContaConferida) => boolean
  ) => {
    for (let i = soNoBling.length - 1; i >= 0; i--) {
      const b = soNoBling[i];

      // Só casa quando a resposta é única dos dois lados. Pegar "o primeiro que
      // bate" parece funcionar e embaralha gente: o site tem quatro vales de
      // R$ 250,00 e o Bling outros quatro, e a primeira versão casou o vale do
      // Maurício com a linha do Douglas e o do Ricardo com a do Jonathan. Nos
      // de valor igual isso não move dinheiro — mas o vale transporte de
      // R$ 324,80 é do Rodrigo, e o botão teria oferecido escrevê-lo no
      // Douglas, que recebeu 364,00.
      //
      // Quando há ambiguidade a conta fica órfã de propósito. Órfã é uma
      // pergunta pra pessoa; par errado é um número errado que ninguém revisa.
      const candidatos = orfaosDoSite.filter((s) => !usados.has(s.id) && combina(s, b));
      if (candidatos.length !== 1) continue;
      const par = candidatos[0];
      if (soNoBling.filter((outro) => combina(par, outro)).length !== 1) continue;

      usados.add(par.id);
      const problemas: string[] = [];
      if (dinheiro(par.valor) !== b.valor)
        problemas.push(`valor: Bling ${b.valor} × site ${dinheiro(par.valor)}`);
      if (dia(par.vencimento) !== b.vencimento)
        problemas.push(`vencimento: Bling ${b.vencimento} × site ${dia(par.vencimento)}`);
      if (nome(par.contraparte ?? "") !== nome(b.contraparte))
        problemas.push(`nome: Bling "${b.contraparte}" × site "${par.contraparte ?? ""}"`);
      divergentes.push({
        ...b,
        siteId: par.id,
        diferenca: problemas.join("; ") || "mesma conta, casada por valor",
        parEncontradoPor: "valor",
      });
      soNoBling.splice(i, 1);
    }
  };

  // Terceira chave: o nome da pessoa, que mora na descricao.
  //
  // "VALE ALIM. RODRIGO TREVISI pix 44998842139" e "VALE ALIMENTAÇÃO RODRIGO
  // TREVISI" sao a mesma conta, mas nao casam por texto igual nem por valor —
  // o Bling ja corrigiu o valor. O que identifica e RODRIGO TREVISI.
  //
  // Cada palavra vale o inverso de quantas contas do site a contem: VALE
  // aparece em seis e quase nao pontua, TREVISI aparece em duas e pontua
  // meio, BARENA aparece em uma e vale um inteiro. Assim a palavra rara e
  // que decide, e LTDA, COMERCIO e INDUSTRIA nao aproximam fornecedor nenhum
  // — sem precisar manter uma lista de palavras a ignorar.
  const palavras = (t: string) =>
    new Set(nome(t).split(" ").filter((w) => w.length >= 4));
  const textoSite = (s: (typeof orfaosDoSite)[number]) =>
    `${s.documento ?? ""} ${s.descricao ?? ""}`;

  const emQuantas = new Map<string, number>();
  for (const s of orfaosDoSite)
    for (const w of palavras(textoSite(s))) emQuantas.set(w, (emQuantas.get(w) ?? 0) + 1);

  const pontos = (a: string, b: string) => {
    const outras = palavras(b);
    let total = 0;
    for (const w of palavras(a))
      if (outras.has(w)) total += 1 / (emQuantas.get(w) ?? 1);
    return total;
  };

  // O melhor tem que ser melhor sozinho, e bom o bastante: 0,8 exige ao menos
  // uma palavra quase exclusiva. Empate nao casa — no setembro de 2026 dois
  // vales de R$ 250,00 empataram porque o Bling tinha RICARDO TAVARES e o site
  // JONATHAN TIRANDENTES. Sao pessoas diferentes mesmo, e ficar orfao e a
  // resposta certa.
  const MINIMO = 0.8;
  const melhorPara = (texto: string) => {
    let campeao: (typeof orfaosDoSite)[number] | null = null;
    let melhor = 0;
    let segundo = 0;
    for (const s of orfaosDoSite) {
      if (usados.has(s.id)) continue;
      const p = pontos(texto, textoSite(s));
      if (p > melhor) {
        segundo = melhor;
        melhor = p;
        campeao = s;
      } else if (p > segundo) segundo = p;
    }
    return melhor >= MINIMO && melhor > segundo ? campeao : null;
  };

  casar((s, b) => {
    const campeao = melhorPara(b.documento);
    // simétrico: o melhor do site tem que ser esta conta do Bling, e nao outra
    if (!campeao || campeao.id !== s.id) return false;
    const meu = pontos(textoSite(s), b.documento);
    return !soNoBling.some(
      (o) => o.blingId !== b.blingId && pontos(textoSite(s), o.documento) >= meu
    );
  });

  // Depois o valor, e so entao o nome da contraparte. A ordem importa: numa
  // passada so — uma chave, senao a outra, conta por conta — um casamento
  // fraco consome a linha que a proxima conta precisava por uma chave forte.
  casar(
    (s, b) =>
      dinheiro(s.valor) === b.valor && emDias(dia(s.vencimento), b.vencimento) <= JANELA_DIAS
  );
  casar(
    (s, b) =>
      nome(s.contraparte ?? "") !== "" &&
      nome(s.contraparte ?? "") === nome(b.contraparte) &&
      emDias(dia(s.vencimento), b.vencimento) <= JANELA_DIAS
  );

  const soNoSite: ContaConferida[] = orfaosDoSite
    .filter((s) => !usados.has(s.id))
    .map((s) => ({
      documento: s.documento ?? s.descricao,
      contraparte: s.contraparte ?? "",
      vencimento: dia(s.vencimento),
      valor: dinheiro(s.valor),
      categoria: s.categoria ?? "sem categoria",
      siteId: s.id,
    }));

  return {
    de,
    ate,
    noBling: bling.length,
    noSite: site.length,
    conferem,
    soNoBling,
    soNoSite,
    divergentes,
  };
}

// Procura contato no Bling por nome. Só lê.
//
// O extrato do Sicoob traz o nome de quem pagou, nunca o CNPJ. Quando aparece um
// pagador que não bate com loja nenhuma, o único lugar que sabe de quem é o
// documento é o ERP — e sem isso a conciliação vira chute.
export async function procurarContatos(termo: string): Promise<
  Array<{ id: number; nome: string; documento: string | null; tipo: string | null }>
> {
  const r = await chamar<{
    data?: Array<{
      id: number;
      nome?: string;
      numeroDocumento?: string;
      tipo?: string;
    }>;
  }>("/contatos", { pesquisa: termo, limite: 100 });
  return (r.data ?? []).map((c) => ({
    id: c.id,
    nome: c.nome ?? "",
    documento: c.numeroDocumento ?? null,
    tipo: c.tipo ?? null,
  }));
}

// Espia o JSON cru de uma pagina da listagem e do detalhe da primeira conta.
//
// Existe porque tres tentativas de adivinhar o formato do Bling saíram erradas
// — filtro de data ignorado, campos que so vem no detalhe, detalhe sobrescrevendo
// o vencimento. Olhar uma vez custa menos que chutar tres.
export async function espiarContas(): Promise<unknown> {
  const lista = await chamar<{ data?: ContaBling[] }>("/contas/pagar", { pagina: 1, limite: 3 });
  const primeira = (lista.data ?? [])[0];
  let detalhe: unknown = null;
  let erroDetalhe: string | null = null;
  if (primeira) {
    try {
      detalhe = await chamar<unknown>(`/contas/pagar/${primeira.id}`);
    } catch (err) {
      erroDetalhe = err instanceof Error ? err.message : String(err);
    }
  }
  return { listagem: lista.data ?? [], detalhe, erroDetalhe };
}

// Todas as contas a pagar de um fornecedor, sem recorte de data.
//
// Serve pra pergunta "o que eu ja paguei pra essa transportadora?" — que foi
// como o frete agrupado apareceu: quatro CT-e cobrados num boleto so, invisiveis
// procurando por valor.
//
// Varre a listagem inteira e filtra pelo id do contato aqui, em vez de mandar
// `idContato` pro Bling: o filtro de data ele ignora em silencio, e nao ha
// motivo pra confiar que os outros filtros sejam diferentes. Depois busca o
// detalhe so das que casaram, porque historico e numero da nota nao vem na
// listagem.
export async function contasDoFornecedor(termo: string): Promise<{
  contato: { id: number; nome: string; documento: string | null } | null;
  contas: Array<{
    id: number;
    vencimento: string;
    valor: number;
    situacao: number | string | null;
    historico: string;
    numeroDocumento: string;
  }>;
}> {
  const achados = await procurarContatos(termo);
  const contato = achados[0] ?? null;
  if (!contato) return { contato: null, contas: [] };

  const bruto: ContaBling[] = [];
  for (let pagina = 1; pagina <= 60; pagina++) {
    const r = await chamar<{ data?: ContaBling[] }>("/contas/pagar", {
      pagina,
      limite: POR_PAGINA,
    });
    const lote = r.data ?? [];
    bruto.push(...lote);
    if (lote.length < POR_PAGINA) break;
  }

  const minhas = bruto.filter((c) => c.contato?.id === contato.id);
  const contas = [];
  for (const c of minhas) {
    let det: Partial<ContaBling> = {};
    try {
      const d = await chamar<{ data?: ContaBling }>(`/contas/pagar/${c.id}`);
      det = d.data ?? {};
    } catch {
      // detalhe que falhou nao apaga a conta da lista
    }
    contas.push({
      id: c.id,
      vencimento: dia(c.vencimento),
      valor: dinheiro(c.valor),
      situacao: c.situacao ?? null,
      historico: (det.historico ?? c.historico ?? "").trim(),
      numeroDocumento: (det.numeroDocumento ?? c.numeroDocumento ?? "").trim(),
    });
  }
  contas.sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1));
  return { contato, contas };
}

// Compara os pedidos do Bling com os do site, dia a dia.
//
// A funcionaria disse que lancou 57 pedidos e o sync trouxe 18. Sem ver os dois
// lados nao da pra saber se faltaram 39, se 39 ja tinham entrado antes, ou se
// eram de outra empresa — o Bling da Fabrica guarda tambem o catalogo da
// Fabrica Loja, que vende no Mercado Livre.
//
// Filtra a data aqui de novo depois de baixar: em /contas/pagar o Bling ignora
// o filtro de data em silencio, respondendo 200 com outro periodo. Nao custa
// nada garantir.
export async function conferirPedidos(
  de: string,
  ate: string
): Promise<{
  de: string;
  ate: string;
  bling: Array<{ numero: string; data: string; cliente: string; total: number }>;
  site: Array<{ id: number; data: string; cliente: string; total: number }>;
  porDia: Array<{ data: string; bling: number; site: number; valorBling: number; valorSite: number }>;
}> {
  const { listarPedidos } = await import("./blingPedidosService");
  const brutos = await listarPedidos(de, ate);
  const bling = brutos
    .filter((p) => p.data >= de && p.data <= ate)
    .map((p) => ({ numero: p.numero, data: p.data, cliente: p.cliente, total: p.total }));

  const { rows } = await pool.query<{
    id: number;
    data: string;
    cliente: string;
    total: string;
  }>(
    `SELECT p.id, p.data::text AS data, c.nome AS cliente,
            COALESCE(SUM(i.quantidade * i.preco_unitario), 0) AS total
       FROM fabrica_pedidos p
       JOIN fabrica_clientes c ON c.id = p.cliente_id
       LEFT JOIN fabrica_pedido_itens i ON i.pedido_id = p.id
      WHERE p.data BETWEEN $1::date AND $2::date AND p.status <> 'CANCELADO'
      GROUP BY p.id, p.data, c.nome
      ORDER BY p.data, p.id`,
    [de, ate]
  );
  const site = rows.map((r) => ({
    id: r.id,
    data: dia(r.data),
    cliente: r.cliente,
    total: dinheiro(r.total),
  }));

  const dias = new Map<string, { bling: number; site: number; valorBling: number; valorSite: number }>();
  const pega = (d: string) => {
    const a = dias.get(d) ?? { bling: 0, site: 0, valorBling: 0, valorSite: 0 };
    dias.set(d, a);
    return a;
  };
  for (const p of bling) {
    const a = pega(p.data);
    a.bling += 1;
    a.valorBling += p.total;
  }
  for (const p of site) {
    const a = pega(p.data);
    a.site += 1;
    a.valorSite += p.total;
  }

  return {
    de,
    ate,
    bling,
    site,
    porDia: [...dias.entries()]
      .map(([data, v]) => ({ data, ...v }))
      .sort((a, b) => (a.data < b.data ? -1 : 1)),
  };
}

// ---------------------------------------------------------------------------
// Escrever categoria no Bling
//
// Aqui o arquivo deixa de ser só leitura, e por isso a porta é estreita: a
// unica coisa que se grava e o campo `categoria` de uma conta a pagar, uma
// conta por chamada, com o id vindo de fora. Nada de apagar, nada em lote
// silencioso — o Hudson perde o historico se algo for removido de la.

interface CategoriaBling {
  id: number;
  descricao: string;
  tipo?: number;
}

export async function listarCategoriasBling(): Promise<CategoriaBling[]> {
  const todas: CategoriaBling[] = [];
  for (let pagina = 1; ; pagina++) {
    const { data } = await chamar<{ data: CategoriaBling[] }>("/categorias/receitas-despesas", {
      pagina,
      limite: POR_PAGINA,
    });
    if (!data?.length) break;
    todas.push(...data);
    if (data.length < POR_PAGINA) break;
  }
  return todas;
}

async function escrever<T = void>(
  caminho: string,
  corpo: unknown,
  metodo: "put" | "post" = "put"
): Promise<T> {
  let espera = 2000;
  for (let tentativa = 1; ; tentativa++) {
    await vez();
    const token = await tokenValido();
    try {
      const resp = await axios[metodo]<T>(`${BASE}${caminho}`, corpo, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        timeout: 30000,
      });
      return resp.data;
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status === 429 && tentativa < TENTATIVAS) {
        await dormir(espera);
        espera *= 2;
        continue;
      }
      if (axios.isAxiosError(err) && err.response) {
        const d = err.response.data as unknown;
        const t = typeof d === "string" ? d : JSON.stringify(d);
        throw new Error(`Bling ${err.response.status}: ${t.slice(0, 300)}`);
      }
      throw err;
    }
  }
}

interface ContaCompleta {
  id?: number;
  vencimento?: string;
  valor?: number;
  saldo?: number;
  dataEmissao?: string;
  competencia?: string;
  numeroDocumento?: string;
  historico?: string;
  contato?: { id?: number };
  formaPagamento?: { id?: number };
  portador?: { id?: number };
  categoria?: { id?: number };
}

export interface Classificacao {
  blingId: number;
  categoriaId: number;
  // Trocar o contato da conta. Serve pra padronizar quem aparece como
  // contraparte: o adiantamento de tres funcionarios usava o contato generico
  // "ADIANTAMENTO SALARIAL" e o do quarto o nome da pessoa, e a conferencia
  // marcava divergencia de nome todo mes por causa disso.
  contatoId?: number;
}

export interface ResultadoClassificacao {
  blingId: number;
  ok: boolean;
  erro?: string;
}

// O PUT do Bling substitui a conta inteira, entao le antes e devolve tudo de
// volta com a categoria trocada. Mandar so o campo apagaria o resto.
export async function classificarContasBling(
  itens: Classificacao[]
): Promise<ResultadoClassificacao[]> {
  const saida: ResultadoClassificacao[] = [];
  for (const it of itens) {
    try {
      const { data: atual } = await chamar<{ data: ContaCompleta }>(
        `/contas/pagar/${it.blingId}`
      );
      if (!atual) throw new Error("conta não encontrada no Bling");

      // Só os campos que o PUT documenta. Mandar a conta inteira do GET faz o
      // Bling responder 200 e ignorar tudo em silêncio — o campo `categoria`
      // não gravava e a conferência seguia mostrando o histórico. Nenhum erro,
      // nenhum aviso: parecia classificado e não estava.
      //
      // `ocorrencia` fica de fora de proposito: e ela que define recorrencia, e
      // mandar o valor errado transformaria um carne em conta unica.
      const corpo: Record<string, unknown> = {
        vencimento: atual.vencimento,
        valor: atual.valor,
        categoria: { id: it.categoriaId },
      };
      const contato = it.contatoId ?? atual.contato?.id;
      if (contato) corpo.contato = { id: contato };
      if (atual.formaPagamento?.id) corpo.formaPagamento = { id: atual.formaPagamento.id };
      if (atual.portador?.id) corpo.portador = { id: atual.portador.id };
      if (atual.saldo !== undefined) corpo.saldo = atual.saldo;
      if (atual.dataEmissao) corpo.dataEmissao = atual.dataEmissao;
      if (atual.competencia) corpo.competencia = atual.competencia;
      if (atual.numeroDocumento) corpo.numeroDocumento = atual.numeroDocumento;
      if (atual.historico) corpo.historico = atual.historico;

      await escrever(`/contas/pagar/${it.blingId}`, corpo);

      // Confere relendo: o 200 do Bling nao prova que gravou.
      const { data: depois } = await chamar<{ data: ContaCompleta }>(
        `/contas/pagar/${it.blingId}`
      );
      if (Number(depois?.categoria?.id ?? 0) !== it.categoriaId) {
        throw new Error("o Bling aceitou o PUT mas a categoria não gravou");
      }
      if (it.contatoId && Number(depois?.contato?.id ?? 0) !== it.contatoId) {
        throw new Error("o Bling aceitou o PUT mas o contato não gravou");
      }
      saida.push({ blingId: it.blingId, ok: true });
    } catch (err) {
      saida.push({
        blingId: it.blingId,
        ok: false,
        erro: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Criar conta a pagar no Bling.
//
// Existe porque o extrato traz compra que ninguem lancou em lugar nenhum: em
// 01 e 02/09/2026 foram R$ 255.208,78 de materia-prima — Oswaldo Cruz,
// Fos-Quimica, Mineracao Matheus Leme — que sairam do banco e nao estavam nem
// no site nem no ERP. Ate aqui eu so sabia classificar o que a funcionaria ja
// tinha digitado.
//
// Manda so os campos documentados, pelo mesmo motivo do PUT: campo que o Bling
// nao conhece ele ignora em silencio e devolve 200. E confere lendo de volta —
// um POST que "deu certo" e nao gravou a categoria e pior que um erro.
export interface NovaContaBling {
  contatoId: number;
  categoriaId: number;
  valor: number;
  vencimento: string;
  historico?: string;
  numeroDocumento?: string;
  dataEmissao?: string;
  competencia?: string;
}

export async function criarContaBling(nova: NovaContaBling): Promise<{ id: number }> {
  if (!Number.isInteger(nova.contatoId) || nova.contatoId <= 0)
    throw new Error("Informe o contato do Bling.");
  if (!Number.isInteger(nova.categoriaId) || nova.categoriaId <= 0)
    throw new Error("Informe a categoria do Bling.");
  if (!Number.isFinite(nova.valor) || nova.valor <= 0) throw new Error("Valor inválido.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nova.vencimento)) throw new Error("Vencimento inválido.");

  const corpo: Record<string, unknown> = {
    vencimento: nova.vencimento,
    valor: nova.valor,
    contato: { id: nova.contatoId },
    categoria: { id: nova.categoriaId },
    dataEmissao: nova.dataEmissao ?? nova.vencimento,
    competencia: nova.competencia ?? nova.vencimento,
  };
  if (nova.historico) corpo.historico = nova.historico;
  if (nova.numeroDocumento) corpo.numeroDocumento = nova.numeroDocumento;

  const criada = await escrever<{ data?: { id?: number } }>("/contas/pagar", corpo, "post");
  const id = Number(criada?.data?.id ?? 0);
  if (!id) throw new Error("o Bling aceitou o POST mas não devolveu o id da conta");

  const { data: depois } = await chamar<{ data: ContaCompleta }>(`/contas/pagar/${id}`);
  if (Number(depois?.categoria?.id ?? 0) !== nova.categoriaId)
    throw new Error(`conta ${id} criada, mas a categoria não gravou`);
  if (Math.abs(Number(depois?.valor ?? 0) - nova.valor) > 0.02)
    throw new Error(`conta ${id} criada com valor ${depois?.valor}, não ${nova.valor}`);
  return { id };
}
