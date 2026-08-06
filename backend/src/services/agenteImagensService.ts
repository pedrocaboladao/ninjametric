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

// Recebe a foto original em base64 (qualquer formato comum), normaliza pro
// tamanho exigido pela API e pede pra IA limpar só o fundo.
export async function tratarFotoProduto(imagemBase64: string): Promise<string> {
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
    prompt: PROMPT_TRATAMENTO,
    size: "1024x1024",
  });

  const resultado = resposta.data?.[0]?.b64_json;
  if (!resultado) {
    throw new Error("IA não devolveu imagem tratada.");
  }
  return resultado;
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
