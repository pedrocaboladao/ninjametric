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
  metodo: "get" | "put" | "post",
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
  codigo?: string;
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
  pessoa_fisica: boolean;
}

// Cada campo que muda vai com o valor de antes junto. Simulacao que so diz
// "e-mail" nao deixa ninguem decidir nada: o que importa e o que vai ser
// apagado. E depois de gravado, e por aqui que da pra voltar atras.
export interface MudancaCampo {
  campo: string;
  antes: string;
  depois: string;
}

export interface LinhaSincronia {
  cliente: string;
  contatoId: number | null;
  contatoNome: string | null;
  campos: MudancaCampo[];
  situacao: "atualizado" | "criado" | "sem mudança" | "não achei no Bling" | "erro";
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

// Monta o contato do jeito que o Bling aceita no cadastro novo.
//
// O nome e a **razao social**, nao o nome de porta: o contato do ERP e o
// destinatario da nota, e no resto do cadastro ele ja esta assim. A razao
// social e o apelido que a importacao usa pra reconhecer o cliente, entao vem
// de la — cadastrar "Cidade Cancao" quando o Bling escreve "CIDADE CANCAO
// LTDA" criaria a divergencia que a tabela de apelidos existe pra resolver.
function corpoNovo(
  cl: ClienteCadastro,
  razaoSocial: string,
  codigo: string
): Record<string, unknown> {
  const ie = (cl.inscricao_estadual ?? "").trim();
  const { fixo, celular } = separarFones(cl.telefone);
  return {
    nome: razaoSocial,
    // F e gente, J e empresa. Mandar CPF num contato marcado J o Bling recusa.
    tipo: cl.pessoa_fisica ? "F" : "J",
    ...(codigo ? { codigo } : {}),
    numeroDocumento: digitos(cl.cnpj),
    situacao: "A",
    // 1 contribuinte, 9 nao contribuinte: sem IE o Bling recusa o 1.
    // Pessoa fisica nao tem inscricao estadual, entao e sempre 9.
    indicadorIe: !cl.pessoa_fisica && ie ? 1 : 9,
    ...(!cl.pessoa_fisica && ie ? { ie } : {}),
    ...(cl.email ? { email: cl.email } : {}),
    ...(fixo ? { telefone: fixo } : {}),
    ...(celular ? { celular } : {}),
    endereco: {
      geral: {
        endereco: cl.logradouro ?? "",
        numero: cl.numero ?? "",
        complemento: cl.complemento ?? "",
        bairro: cl.bairro ?? "",
        cep: cl.cep ?? "",
        municipio: cl.cidade ?? "",
        uf: cl.uf ?? "",
      },
    },
  };
}

export async function sincronizarContatos(
  simulacao: boolean,
  criarFaltantes = false
): Promise<ResultadoSincronia> {
  const { rows: clientes } = await pool.query<ClienteCadastro>(
    `SELECT id, nome, cnpj, inscricao_estadual, email, telefone, cep,
            logradouro, numero, complemento, bairro, cidade, uf, pessoa_fisica
       FROM fabrica_clientes
      WHERE cnpj IS NOT NULL AND cnpj <> ''
      ORDER BY nome`
  );

  // razao social de cada cliente, pra nomear o contato novo do mesmo jeito que
  // a importacao reconhece.
  //
  // Nem todo apelido serve: a tabela guarda tambem apelido curto de operacao
  // ("truck1", "truck2"), que existe pra digitar rapido, nao pra sair na nota.
  // Pegar o primeiro por id cadastraria no ERP um destinatario chamado
  // "truck1" — e o contato do Bling e quem recebe a nota fiscal.
  //
  // Razao social sempre tem espaco; apelido de operacao nao tem. Entre os que
  // tem espaco vale o mais longo, que e o nome por extenso. Nenhum servindo,
  // fica o nome do cadastro daqui, que e melhor que um apelido de digitacao.
  const { rows: apelidos } = await pool.query<{ cliente_id: number; apelido: string }>(
    "SELECT cliente_id, apelido FROM fabrica_cliente_apelidos ORDER BY id"
  );
  const razao = new Map<number, string>();
  // O outro lado do mesmo corte: apelido sem espaco e codigo de operacao, e vai
  // pro campo "Codigo" do contato no Bling. E o que faz "truck3" achar no ERP
  // uma empresa chamada W. L. P DOS SANTOS JUNIOR LTDA. Havendo mais de um,
  // vale o mais curto — codigo comprido ninguem digita.
  const codigo = new Map<number, string>();
  for (const a of apelidos) {
    const nome = a.apelido.trim();
    if (!nome) continue;
    if (nome.includes(" ")) {
      const atual = razao.get(a.cliente_id);
      if (!atual || nome.length > atual.length) razao.set(a.cliente_id, nome);
    } else {
      const atual = codigo.get(a.cliente_id);
      if (!atual || nome.length < atual.length) codigo.set(a.cliente_id, nome.toUpperCase());
    }
  }

  const linhas: LinhaSincronia[] = [];
  let encontrados = 0;
  for (const cl of clientes) {
    const doc = digitos(cl.cnpj);
    const achado = await acharPorDocumento(doc);
    if (achado) encontrados++;
    if (!achado) {
      if (!criarFaltantes) {
        linhas.push({
          cliente: cl.nome,
          contatoId: null,
          contatoNome: null,
          campos: [],
          situacao: "não achei no Bling",
        });
        continue;
      }
      const nome = razao.get(cl.id) ?? cl.nome;
      const novo = corpoNovo(cl, nome, codigo.get(cl.id) ?? "");
      if (simulacao) {
        linhas.push({
          cliente: cl.nome,
          contatoId: null,
          contatoNome: nome,
          campos: [{ campo: "contato novo", antes: "", depois: nome }],
          situacao: "criado",
        });
        continue;
      }
      try {
        const r = await chamar<{ data?: { id?: number } }>(
          "post",
          "/contatos",
          undefined,
          novo
        );
        linhas.push({
          cliente: cl.nome,
          contatoId: r.data?.id ?? null,
          contatoNome: nome,
          campos: [{ campo: "contato novo", antes: "", depois: nome }],
          situacao: "criado",
        });
      } catch (err) {
        linhas.push({
          cliente: cl.nome,
          contatoId: null,
          contatoNome: nome,
          campos: [],
          situacao: "erro",
          erro: err instanceof Error ? err.message : "falha ao criar o contato",
        });
      }
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

    const campos: MudancaCampo[] = [];
    const corpo: ContatoBling = { ...inteiro };
    const anotar = (campo: string, antes: unknown, depois: string) =>
      campos.push({ campo, antes: String(antes ?? "").trim(), depois });

    const cod = codigo.get(cl.id) ?? "";
    if (cod && String(inteiro.codigo ?? "").trim().toUpperCase() !== cod) {
      anotar("código", inteiro.codigo, cod);
      corpo.codigo = cod;
    }

    const ie = cl.pessoa_fisica ? "" : (cl.inscricao_estadual ?? "").trim();
    if (ie && digitos(inteiro.ie) !== digitos(ie)) {
      anotar("IE", inteiro.ie, ie);
      corpo.ie = ie;
      // sem isento marcado o Bling recusa IE preenchida
      corpo.indicadorIe = 1;
    }
    if (cl.email && (inteiro.email ?? "").toLowerCase() !== cl.email.toLowerCase()) {
      anotar("e-mail", inteiro.email, cl.email);
      corpo.email = cl.email;
    }

    const { fixo, celular } = separarFones(cl.telefone);
    if (fixo && digitos(inteiro.telefone) !== fixo) {
      anotar("telefone", inteiro.telefone, fixo);
      corpo.telefone = fixo;
    }
    if (celular && digitos(inteiro.celular) !== celular) {
      anotar("celular", inteiro.celular, celular);
      corpo.celular = celular;
    }

    const geral = (inteiro.endereco?.geral ?? {}) as Record<string, unknown>;
    const novoEndereco: Record<string, unknown> = { ...geral };
    const trocar = (chave: string, valor: string | null, rotulo: string) => {
      if (!valor) return;
      const atual = String(novoEndereco[chave] ?? "").trim();
      if (atual.toUpperCase() === valor.trim().toUpperCase()) return;
      anotar(rotulo, atual, valor.trim());
      novoEndereco[chave] = valor.trim();
    };
    trocar("endereco", cl.logradouro, "logradouro");
    trocar("numero", cl.numero, "número");
    trocar("complemento", cl.complemento, "complemento");
    trocar("bairro", cl.bairro, "bairro");
    trocar("municipio", cl.cidade, "município");
    trocar("uf", cl.uf, "UF");
    if (cl.cep && digitos(novoEndereco.cep as string) !== digitos(cl.cep)) {
      anotar("CEP", novoEndereco.cep, cl.cep);
      novoEndereco.cep = cl.cep;
    }
    if (campos.some((c) => ENDERECO.has(c.campo))) {
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
