import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { env } from "../config/env";

// gpt-image-2 exige dimensões múltiplas de 16px e total de pixels entre
// ~655k e ~8.3M — em vez de validar/rejeitar fotos reais de celular que não
// batem com isso, normaliza toda entrada pra um quadrado fixo (que sempre
// satisfaz a regra) antes de mandar pra API.
const TAMANHO = 1024;
const MODELO_IMAGEM = "gpt-image-2";

let clienteOpenAI: OpenAI | null | undefined;
function obterClienteOpenAI(): OpenAI | null {
  if (clienteOpenAI === undefined) {
    clienteOpenAI = env.openaiApiKey ? new OpenAI({ apiKey: env.openaiApiKey }) : null;
  }
  return clienteOpenAI;
}

const PROMPT_TRATAMENTO =
  "Esta é uma foto real de um produto de loja de tinta e material de construção. Troque o fundo por um fundo " +
  "branco/neutro limpo, com iluminação uniforme e sombra suave, no estilo de uma foto profissional de e-commerce. " +
  "Não altere o produto em si: mantenha exatamente a mesma embalagem, rótulo, texto, cores e proporções do produto " +
  "original — mexa só no ambiente ao redor.";

// Normaliza a foto original (qualquer formato/tamanho) pro quadrado exigido
// pela API e manda editar com o prompt dado — usado tanto pra limpar fundo
// quanto pra montar cada slide do kit de fotos.
async function editarFoto(imagemBase64: string, prompt: string): Promise<string> {
  const client = obterClienteOpenAI();
  if (!client) {
    throw new Error("IA de imagens não configurada neste ambiente (falta OPENAI_API_KEY).");
  }

  const bufferOriginal = Buffer.from(imagemBase64, "base64");
  const bufferNormalizado = await sharp(bufferOriginal)
    .resize(TAMANHO, TAMANHO, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();

  const resposta = await client.images.edit({
    model: MODELO_IMAGEM,
    image: await toFile(bufferNormalizado, "foto.png", { type: "image/png" }),
    prompt,
    size: "1024x1024",
  });

  const resultado = resposta.data?.[0]?.b64_json;
  if (!resultado) {
    throw new Error("IA não devolveu imagem.");
  }
  return resultado;
}

// Recebe a foto original em base64 (qualquer formato comum) e pede pra IA
// limpar só o fundo, mantendo o produto idêntico.
export async function tratarFotoProduto(imagemBase64: string): Promise<string> {
  return editarFoto(imagemBase64, PROMPT_TRATAMENTO);
}

const PROMPT_ARTE_BASE =
  "Crie uma arte promocional profissional para uma loja de tinta e material de construção que vende no Mercado " +
  "Livre, estilo e-commerce brasileiro, cores vivas e texto legível. Pedido do dono da loja: ";

// Gera uma imagem do zero a partir de uma descrição livre — não usa/edita
// nenhuma foto real, então não tem o risco de "deturpar" um produto real.
export async function criarArtePromocional(descricao: string): Promise<string> {
  const client = obterClienteOpenAI();
  if (!client) {
    throw new Error("IA de imagens não configurada neste ambiente (falta OPENAI_API_KEY).");
  }

  const resposta = await client.images.generate({
    model: MODELO_IMAGEM,
    prompt: `${PROMPT_ARTE_BASE}${descricao}`,
    size: "1024x1024",
  });

  const resultado = resposta.data?.[0]?.b64_json;
  if (!resultado) {
    throw new Error("IA não devolveu a arte gerada.");
  }
  return resultado;
}

export interface DadosKitFotos {
  nomeProduto: string;
  subtitulo: string;
  cores: string;
  beneficios: string[];
  especificacaoPrincipal: string;
  specsSecundarias: string[];
  ondeAplicar: string[];
}

// Pedido explícito em todo slide com texto — o modelo já errou ortografia
// em português em testes reais (ex.: "TELNADOS" em vez de "TELHADOS"), essa
// instrução não elimina o risco mas ajuda a reduzir.
const AVISO_TEXTO =
  "Revise a ortografia com atenção — todo o texto da imagem deve estar em português correto, sem erros de digitação.";

function listaTexto(itens: string[]): string {
  return itens.filter((i) => i.trim().length > 0).join(", ");
}

// Kit de 5 fotos pra anúncio do Mercado Livre a partir de 1 foto real do
// produto: capa, benefícios, especificações, onde aplicar e a foto tratada
// (fundo limpo). Cada slide é uma edição separada da mesma foto original —
// não inclui "antes/depois" de propósito, porque isso implicaria fabricar
// uma prova de resultado que não existe de verdade.
export async function gerarKitFotos(imagemBase64: string, dados: DadosKitFotos): Promise<string[]> {
  const prompts = [
    `Crie uma arte de capa de anúncio de e-commerce brasileiro usando o produto da foto fornecida. Título grande e chamativo: "${dados.nomeProduto}". Subtítulo: "${dados.subtitulo}". ${dados.cores}. Produto centralizado e em destaque. ${AVISO_TEXTO}`,
    `Crie uma arte de e-commerce em lista mostrando os benefícios do produto da foto fornecida, com um ícone simples ao lado de cada item: ${listaTexto(dados.beneficios)}. ${dados.cores}. Produto em destaque ao lado da lista. ${AVISO_TEXTO}`,
    `Crie uma arte de e-commerce destacando em fonte bem grande a especificação principal "${dados.especificacaoPrincipal}", com especificações menores abaixo: ${listaTexto(dados.specsSecundarias)}. ${dados.cores}. Produto da foto fornecida em destaque. ${AVISO_TEXTO}`,
    `Crie uma arte de e-commerce em grade/colagem mostrando onde o produto da foto fornecida pode ser usado, com um ícone e legenda curta por item: ${listaTexto(dados.ondeAplicar)}. ${dados.cores}. Produto em destaque num canto. ${AVISO_TEXTO}`,
  ];

  const [slides, fotoLimpa] = await Promise.all([
    Promise.all(prompts.map((prompt) => editarFoto(imagemBase64, prompt))),
    tratarFotoProduto(imagemBase64),
  ]);

  return [fotoLimpa, ...slides];
}
