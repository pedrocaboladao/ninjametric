import Anthropic from "@anthropic-ai/sdk";
import {
  extrairItemIdDaUrl,
  getItemFullComToken,
  getItemDescriptionComToken,
  resolverItemIdPorUserProduct,
  type MlItemFull,
  type IdentificadorAnuncio,
} from "./mercadoLivreItems";
import { listLojas } from "./tokenStore";
import { env } from "../config/env";
import { pool } from "../db/pool";

// Igual ao "encontrarLojaDonaEItem" de clonarAnuncioService.ts (não
// exportado de lá, então reimplementado aqui do zero pra não arriscar
// mexer naquele módulo já testado) — o Mercado Livre só deixa ler detalhes
// completos de um anúncio com o token da própria conta dona dele, então
// tenta o token de cada loja cadastrada até achar a dona.
async function encontrarItemComLoja(identificador: IdentificadorAnuncio): Promise<{ lojaId: number; item: MlItemFull }> {
  const lojas = (await listLojas()).filter((l) => l.ml_user_id !== null);

  for (const loja of lojas) {
    try {
      if (identificador.tipo === "user_product") {
        const itemId = await resolverItemIdPorUserProduct(loja.id, loja.ml_user_id as number, identificador.id);
        if (!itemId) continue;
        return { lojaId: loja.id, item: await getItemFullComToken(loja.id, itemId) };
      }
      return { lojaId: loja.id, item: await getItemFullComToken(loja.id, identificador.id) };
    } catch {
      // não é dessa loja, tenta a próxima
    }
  }

  throw new Error(
    "Esse anúncio não pertence a nenhuma das suas lojas cadastradas — só dá pra puxar dados de anúncios que já são seus."
  );
}

async function baixarImagemComoBase64(url: string): Promise<string | null> {
  try {
    const resposta = await fetch(url);
    if (!resposta.ok) return null;
    const buffer = Buffer.from(await resposta.arrayBuffer());
    return buffer.toString("base64");
  } catch {
    return null;
  }
}

const MODELO_IA = "claude-sonnet-5";

let clienteAnthropic: Anthropic | null | undefined;
function obterClienteAnthropic(): Anthropic | null {
  if (clienteAnthropic === undefined) {
    clienteAnthropic = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;
  }
  return clienteAnthropic;
}

const FERRAMENTA_CAMPOS_KIT: Anthropic.Tool = {
  name: "preencher_campos_kit",
  description: "Preenche os campos do kit de fotos de anúncio a partir dos dados reais do produto.",
  input_schema: {
    type: "object",
    properties: {
      subtitulo: { type: "string", description: "Subtítulo curto (uma linha) com o uso/proposta principal do produto." },
      beneficios: {
        type: "array",
        items: { type: "string" },
        description: "3 a 6 benefícios curtos, um por item, baseados no texto real do anúncio.",
      },
      especificacao_principal: {
        type: "string",
        description:
          "A especificação mais chamativa pra destacar em fonte grande (ex: rendimento, quantidade, potência) — só se houver base real no texto, senão string vazia.",
      },
      specs_secundarias: {
        type: "array",
        items: { type: "string" },
        description: "3 a 6 especificações técnicas menores, formato 'nome: valor', baseadas na ficha técnica real.",
      },
      onde_aplicar: {
        type: "array",
        items: { type: "string" },
        description: "3 a 6 locais/situações de uso do produto, baseados no texto real.",
      },
    },
    required: ["subtitulo", "beneficios", "especificacao_principal", "specs_secundarias", "onde_aplicar"],
  },
};

export interface CamposSugeridosKit {
  subtitulo: string;
  beneficios: string[];
  especificacaoPrincipal: string;
  specsSecundarias: string[];
  ondeAplicar: string[];
}

// "Memória" prática do Agente de Imagens — não é a IA aprendendo de
// verdade, é o sistema guardando os campos que o dono editou depois da
// sugestão automática e devolvendo isso como referência de estilo na
// próxima sugestão. Chamado pela rota do kit sempre que uma sugestão de
// "buscar anúncio" foi usada e o dono mudou algum campo antes de gerar.
export async function registrarCorrecoes(sugestao: CamposSugeridosKit, final: CamposSugeridosKit): Promise<void> {
  const juntar = (arr: string[]) => arr.join(" | ");
  const campos: Array<[string, string, string]> = [];
  if (sugestao.subtitulo !== final.subtitulo) campos.push(["subtitulo", sugestao.subtitulo, final.subtitulo]);
  if (juntar(sugestao.beneficios) !== juntar(final.beneficios)) {
    campos.push(["beneficios", juntar(sugestao.beneficios), juntar(final.beneficios)]);
  }
  if (sugestao.especificacaoPrincipal !== final.especificacaoPrincipal) {
    campos.push(["especificacao_principal", sugestao.especificacaoPrincipal, final.especificacaoPrincipal]);
  }
  if (juntar(sugestao.specsSecundarias) !== juntar(final.specsSecundarias)) {
    campos.push(["specs_secundarias", juntar(sugestao.specsSecundarias), juntar(final.specsSecundarias)]);
  }
  if (juntar(sugestao.ondeAplicar) !== juntar(final.ondeAplicar)) {
    campos.push(["onde_aplicar", juntar(sugestao.ondeAplicar), juntar(final.ondeAplicar)]);
  }
  if (campos.length === 0) return;

  await Promise.all(
    campos.map(([campo, valorSugerido, valorFinal]) =>
      pool.query("INSERT INTO agente_imagens_correcoes (campo, valor_sugerido, valor_final) VALUES ($1, $2, $3)", [
        campo,
        valorSugerido.slice(0, 500),
        valorFinal.slice(0, 500),
      ])
    )
  );
}

async function buscarResumoCorrecoes(): Promise<string> {
  const { rows } = await pool.query<{ campo: string; valor_sugerido: string; valor_final: string }>(
    "SELECT campo, valor_sugerido, valor_final FROM agente_imagens_correcoes ORDER BY criado_em DESC LIMIT 12"
  );
  if (rows.length === 0) return "";
  const linhas = rows.map((r) => `- campo "${r.campo}": a IA sugeriu "${r.valor_sugerido}", o dono trocou por "${r.valor_final}"`);
  return `\n\nExemplos recentes de como o dono costuma ajustar as sugestões (use como referência de estilo/preferência dele, mas SEMPRE baseado no texto real do produto atual — nunca copie um valor de outro produto):\n${linhas.join(
    "\n"
  )}`;
}

// Preenche os campos "de texto" do kit (subtítulo, benefícios, specs, onde
// aplicar) a partir do título/descrição/ficha técnica reais do anúncio —
// nunca inventa número ou benefício que não esteja no texto original.
// Devolve null se a IA não estiver configurada ou a chamada falhar (quem
// chama cai pro preenchimento manual nesse caso, nunca trava o resto).
export async function sugerirCamposKit(titulo: string, descricao: string, atributos: string[]): Promise<CamposSugeridosKit | null> {
  const client = obterClienteAnthropic();
  if (!client) return null;

  const resumoCorrecoes = await buscarResumoCorrecoes();

  const resposta = await client.messages.create({
    model: MODELO_IA,
    max_tokens: 1500,
    system:
      "Você ajuda a preencher um kit de fotos de anúncio de e-commerce (Mercado Livre) a partir dos dados reais de " +
      "um produto já anunciado. Use só informação que realmente aparece no título, descrição ou ficha técnica — " +
      `nunca invente número, especificação ou benefício que não esteja no texto. Responda em português.${resumoCorrecoes}`,
    messages: [
      {
        role: "user",
        content: `Título: ${titulo}\n\nDescrição:\n${descricao || "(sem descrição)"}\n\nFicha técnica:\n${
          atributos.join("\n") || "(sem atributos)"
        }\n\nPreencha os campos do kit de fotos.`,
      },
    ],
    tools: [FERRAMENTA_CAMPOS_KIT],
    tool_choice: { type: "tool", name: "preencher_campos_kit" },
  });

  const bloco = resposta.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!bloco) return null;

  const dados = bloco.input as {
    subtitulo?: string;
    beneficios?: unknown;
    especificacao_principal?: string;
    specs_secundarias?: unknown;
    onde_aplicar?: unknown;
  };
  const paraArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((i): i is string => typeof i === "string") : []);

  return {
    subtitulo: typeof dados.subtitulo === "string" ? dados.subtitulo : "",
    beneficios: paraArray(dados.beneficios),
    especificacaoPrincipal: typeof dados.especificacao_principal === "string" ? dados.especificacao_principal : "",
    specsSecundarias: paraArray(dados.specs_secundarias),
    ondeAplicar: paraArray(dados.onde_aplicar),
  };
}

export interface DadosAnuncioParaKit {
  titulo: string;
  fotoBase64: string | null;
  subtitulo: string;
  beneficios: string[];
  especificacaoPrincipal: string;
  specsSecundarias: string[];
  ondeAplicar: string[];
}

// Puxa título, descrição, ficha técnica e a foto principal de um anúncio já
// existente (de uma das lojas cadastradas) e usa a IA pra já sugerir todos
// os campos de texto do Kit de Fotos — o dono só revisa antes de gerar.
export async function buscarDadosAnuncio(url: string): Promise<DadosAnuncioParaKit> {
  const identificador = await extrairItemIdDaUrl(url);
  const { lojaId, item } = await encontrarItemComLoja(identificador);

  const [descricao, fotoBase64] = await Promise.all([
    getItemDescriptionComToken(lojaId, item.id),
    item.pictures[0] ? baixarImagemComoBase64(item.pictures[0].secure_url) : Promise.resolve(null),
  ]);

  const atributos = item.attributes
    .map((a) => `${a.name ?? a.id}: ${a.value_name ?? a.value_id ?? ""}`)
    .filter((linha) => !linha.endsWith(": "));

  let sugeridos: CamposSugeridosKit | null = null;
  try {
    sugeridos = await sugerirCamposKit(item.title, descricao, atributos);
  } catch (err) {
    console.error("Falha ao sugerir campos do kit com IA, deixando pra preencher manualmente:", err);
  }

  return {
    titulo: item.title,
    fotoBase64,
    subtitulo: sugeridos?.subtitulo ?? "",
    beneficios: sugeridos?.beneficios ?? [],
    especificacaoPrincipal: sugeridos?.especificacaoPrincipal ?? "",
    specsSecundarias: sugeridos?.specsSecundarias ?? atributos,
    ondeAplicar: sugeridos?.ondeAplicar ?? [],
  };
}
