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
  const [bling, { rows: site }] = await Promise.all([
    baixarDoBling(de, ate),
    pool.query<LinhaSite>(
      `SELECT id, documento, descricao, contraparte, categoria, valor, vencimento::text AS vencimento
         FROM fabrica_contas
        WHERE tipo = 'pagar' AND vencimento BETWEEN $1::date AND $2::date`,
      [de, ate]
    ),
  ]);

  // indexa o site pelo documento; o que não tem número entra por
  // contraparte + vencimento + valor, que é o que sobra pra identificar a conta
  const porChave = new Map<string, LinhaSite>();
  const porFato = new Map<string, LinhaSite>();
  for (const s of site) {
    const k = chave(s.documento, s.descricao);
    if (k) porChave.set(k, s);
    porFato.set(
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
    const achado =
      (k ? porChave.get(k) : undefined) ??
      porFato.get(`${nome.toUpperCase()}|${venc}|${valor}`);
    const linha: ContaConferida = {
      documento: k ?? b.historico ?? String(b.id),
      contraparte: nome,
      vencimento: venc,
      valor,
      // O Bling manda categoria {id: 0} — ele nao classifica conta a pagar. O
      // que sobra e o historico, que na pratica e onde a fabrica escreve tanto
      // o numero da nota ("700296") quanto o tipo do gasto ("EMBALAGEM").
      categoria:
        b.categoria?.descricao?.trim() ||
        (k ? "nota com numero" : (b.historico ?? "").trim() || "sem historico"),
      blingId: b.id,
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
      divergentes.push({ ...linha, siteId: achado.id, diferenca: problemas.join("; ") });
    } else {
      conferem++;
    }
  }

  const soNoSite: ContaConferida[] = site
    .filter((s) => !vistos.has(s.id))
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
