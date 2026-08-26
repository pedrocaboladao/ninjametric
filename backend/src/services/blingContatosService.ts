import axios from "axios";
import { pool } from "../db/pool";
import { tokenValido } from "./blingAuth";

// Espelha o cadastro de cliente daqui no contato do Bling.
//
// O cartão CNPJ chegou pelas 21 lojas de uma vez e o cadastro daqui ficou
// completo — CNPJ, inscrição estadual, endereço, e-mail, telefone. No ERP o
// mesmo contato continuava com metade dos campos em branco, e é o ERP que
// emite a nota.
//
// A chave é o **CNPJ**, não o nome: no Bling o mesmo cliente aparece escrito
// de jeitos diferentes, e foi justamente por isso que precisou existir a
// tabela de apelidos. Documento é o que não muda.
//
// Escreve por leitura e devolução: busca o contato inteiro, troca só os campos
// que a gente conhece e manda de volta o resto como veio. Montar o corpo do
// zero apagaria o que o Bling guarda e a gente não modela — condição de
// pagamento, vendedor, observação, tipos de contato.

const BASE = "https://api.bling.com.br/Api/v3";
const POR_PAGINA = 100;
// mesmo teto de 3 chamadas por segundo dos pedidos
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

async function chamar<T>(
  metodo: "get" | "put",
  caminho: string,
  params?: Record<string, unknown>,
  corpo?: unknown
): Promise<T> {
  let espera = 2000;
  for (let tentativa = 1; ; tentativa++) {
    await vez();
    const token = await tokenValido();
    try {
      const { data } = await axios.request<T>({
        method: metodo,
        url: `${BASE}${caminho}`,
        params,
        data: corpo,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(corpo ? { "Content-Type": "application/json" } : {}),
        },
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

// O contato do Bling tem mais campo do que a gente usa. Só os que interessam
// estão tipados; o resto viaja de volta intacto dentro do objeto original.
interface ContatoBling {
  id: number;
  nome?: string;
  numeroDocumento?: string;
  ie?: string;
  rg?: string;
  email?: string;
  telefone?: string;
  celular?: string;
  tipo?: string;
  indicadorIe?: number;
  endereco?: {
    geral?: Record<string, unknown>;
    cobranca?: Record<string, unknown>;
  };
  [k: string]: unknown;
}

function digitos(t: string | null | undefined): string {
  return String(t ?? "").replace(/\D/g, "");
}

// Procura um contato pelo documento em vez de varrer a base inteira.
//
// Varrer nao serve: o Bling da Fabrica guarda tambem os clientes finais da
// Fabrica Loja, que vende no Mercado Livre. Sao milhares de contatos, e a
// 3 chamadas por segundo a listagem completa passou de quatro minutos sem
// terminar. Sao 21 lojas — buscar cada uma custa uma chamada.
//
// Tenta o filtro de documento e cai pra busca livre: os dois existem, e qual
// deles o Bling aceita depende de versao. De todo jeito o que vale e a
// conferencia do documento na volta, nao a confianca no filtro.
async function acharPorDocumento(doc: string): Promise<ContatoBling | null> {
  for (const chave of ["numeroDocumento", "pesquisa"]) {
    try {
      const r = await chamar<{ data?: ContatoBling[] }>("get", "/contatos", {
        [chave]: doc,
        limite: POR_PAGINA,
      });
      const achado = (r.data ?? []).find((c) => digitos(c.numeroDocumento) === doc);
      if (achado) return achado;
    } catch {
      // filtro que o Bling nao conhece vira 400: tenta o proximo jeito
    }
  }
  return null;
}

interface ClienteCadastro {
  id: number;
  nome: string;
  cnpj: string | null;
  inscricao_estadual: string | null;
  email: string | null;
  telefone: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
}

export interface LinhaSincronia {
  cliente: string;
  contatoId: number | null;
  contatoNome: string | null;
  campos: string[];
  situacao: "atualizado" | "sem mudança" | "não achei no Bling" | "erro";
  erro?: string;
}

export interface ResultadoSincronia {
  simulacao: boolean;
  clientes: number;
  contatosBling: number;
  linhas: LinhaSincronia[];
}

// Telefone daqui vem como "(44) 3029-2849 / (44) 99843-1727": fixo e celular
// na mesma caixa, porque o cadastro tem um campo só. O Bling tem os dois, e
// separar aqui é o que evita jogar celular no campo de fixo.
function separarFones(t: string | null): { fixo: string; celular: string } {
  const partes = String(t ?? "")
    .split("/")
    .map((p) => digitos(p))
    .filter(Boolean);
  let fixo = "";
  let celular = "";
  for (const p of partes) {
    // 11 dígitos com 9 na frente do número é celular; 10 é fixo
    if (p.length === 11) celular = celular || p;
    else if (p.length === 10) fixo = fixo || p;
  }
  return { fixo, celular };
}

export async function sincronizarContatos(simulacao: boolean): Promise<ResultadoSincronia> {
  const { rows: clientes } = await pool.query<ClienteCadastro>(
    `SELECT id, nome, cnpj, inscricao_estadual, email, telefone, cep,
            logradouro, numero, complemento, bairro, cidade, uf
       FROM fabrica_clientes
      WHERE cnpj IS NOT NULL AND cnpj <> ''
      ORDER BY nome`
  );

  const linhas: LinhaSincronia[] = [];
  let encontrados = 0;
  for (const cl of clientes) {
    const doc = digitos(cl.cnpj);
    const achado = await acharPorDocumento(doc);
    if (achado) encontrados++;
    if (!achado) {
      linhas.push({
        cliente: cl.nome,
        contatoId: null,
        contatoNome: null,
        campos: [],
        situacao: "não achei no Bling",
      });
      continue;
    }

    // busca o contato inteiro: a listagem devolve resumo, e mandar o resumo de
    // volta apagaria o que ela não traz
    let inteiro: ContatoBling;
    try {
      const r = await chamar<{ data: ContatoBling }>("get", `/contatos/${achado.id}`);
      inteiro = r.data;
    } catch (err) {
      linhas.push({
        cliente: cl.nome,
        contatoId: achado.id,
        contatoNome: achado.nome ?? null,
        campos: [],
        situacao: "erro",
        erro: err instanceof Error ? err.message : "falha ao ler o contato",
      });
      continue;
    }

    const campos: string[] = [];
    const corpo: ContatoBling = { ...inteiro };

    const ie = (cl.inscricao_estadual ?? "").trim();
    if (ie && digitos(inteiro.ie) !== digitos(ie)) {
      corpo.ie = ie;
      // sem isento marcado o Bling recusa IE preenchida
      corpo.indicadorIe = 1;
      campos.push("IE");
    }
    if (cl.email && (inteiro.email ?? "").toLowerCase() !== cl.email.toLowerCase()) {
      corpo.email = cl.email;
      campos.push("e-mail");
    }

    const { fixo, celular } = separarFones(cl.telefone);
    if (fixo && digitos(inteiro.telefone) !== fixo) {
      corpo.telefone = fixo;
      campos.push("telefone");
    }
    if (celular && digitos(inteiro.celular) !== celular) {
      corpo.celular = celular;
      campos.push("celular");
    }

    const geral = (inteiro.endereco?.geral ?? {}) as Record<string, unknown>;
    const novoEndereco: Record<string, unknown> = { ...geral };
    const trocar = (chave: string, valor: string | null, rotulo: string) => {
      if (!valor) return;
      const atual = String(novoEndereco[chave] ?? "").trim();
      if (atual.toUpperCase() === valor.trim().toUpperCase()) return;
      novoEndereco[chave] = valor.trim();
      campos.push(rotulo);
    };
    trocar("endereco", cl.logradouro, "logradouro");
    trocar("numero", cl.numero, "número");
    trocar("complemento", cl.complemento, "complemento");
    trocar("bairro", cl.bairro, "bairro");
    trocar("municipio", cl.cidade, "município");
    trocar("uf", cl.uf, "UF");
    if (cl.cep && digitos(novoEndereco.cep as string) !== digitos(cl.cep)) {
      novoEndereco.cep = cl.cep;
      campos.push("CEP");
    }
    if (campos.some((c) => ENDERECO.has(c))) {
      corpo.endereco = { ...(inteiro.endereco ?? {}), geral: novoEndereco };
    }

    if (!campos.length) {
      linhas.push({
        cliente: cl.nome,
        contatoId: achado.id,
        contatoNome: inteiro.nome ?? null,
        campos: [],
        situacao: "sem mudança",
      });
      continue;
    }

    if (simulacao) {
      linhas.push({
        cliente: cl.nome,
        contatoId: achado.id,
        contatoNome: inteiro.nome ?? null,
        campos,
        situacao: "atualizado",
      });
      continue;
    }

    try {
      await chamar("put", `/contatos/${achado.id}`, undefined, corpo);
      linhas.push({
        cliente: cl.nome,
        contatoId: achado.id,
        contatoNome: inteiro.nome ?? null,
        campos,
        situacao: "atualizado",
      });
    } catch (err) {
      linhas.push({
        cliente: cl.nome,
        contatoId: achado.id,
        contatoNome: inteiro.nome ?? null,
        campos,
        situacao: "erro",
        erro: err instanceof Error ? err.message : "falha ao gravar",
      });
    }
  }

  return {
    simulacao,
    clientes: clientes.length,
    contatosBling: encontrados,
    linhas,
  };
}

const ENDERECO = new Set([
  "logradouro",
  "número",
  "complemento",
  "bairro",
  "município",
  "UF",
  "CEP",
]);
