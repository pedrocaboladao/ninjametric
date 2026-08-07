import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { env } from "../config/env";

// gpt-image-2 exige dimensões múltiplas de 16px e total de pixels entre
// ~655k e ~8.3M — em vez de validar/rejeitar fotos reais de celular que não
// batem com isso, normaliza toda entrada pra um quadrado fixo (que sempre
// satisfaz a regra) antes de mandar pra API.
const TAMANHO = 1024;
const MODELO_IMAGEM = "gpt-image-2";
// "high" custa mais por imagem que o padrão, mas é bem mais fiel/nítido —
// vale a pena pro caso de uso (fotos que vão pro anúncio de verdade).
const QUALIDADE = "high";

let clienteOpenAI: OpenAI | null | undefined;
function obterClienteOpenAI(): OpenAI | null {
  if (clienteOpenAI === undefined) {
    clienteOpenAI = env.openaiApiKey ? new OpenAI({ apiKey: env.openaiApiKey }) : null;
  }
  return clienteOpenAI;
}

async function normalizar(imagemBase64: string) {
  const buffer = Buffer.from(imagemBase64, "base64");
  const normalizado = await sharp(buffer)
    .resize(TAMANHO, TAMANHO, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();
  return normalizado;
}

const PROMPT_TRATAMENTO =
  "Esta é uma foto real de um produto de loja de tinta e material de construção. Troque o fundo por um fundo " +
  "branco/neutro limpo, com iluminação uniforme e sombra suave, no estilo de uma foto profissional de e-commerce. " +
  "Não altere o produto em si: mantenha exatamente a mesma embalagem, rótulo, texto, cores e proporções do produto " +
  "original — mexa só no ambiente ao redor.";

// Normaliza cada imagem de entrada (qualquer formato/tamanho) e manda editar
// com o prompt dado — aceita mais de uma imagem porque a API usa isso pra
// "referência de estilo": a primeira é sempre o produto real, uma segunda
// opcional é um exemplo de layout/cor que a IA deve seguir.
async function editarFoto(imagensBase64: string[], prompt: string): Promise<string> {
  const client = obterClienteOpenAI();
  if (!client) {
    throw new Error("IA de imagens não configurada neste ambiente (falta OPENAI_API_KEY).");
  }

  const arquivos = await Promise.all(
    imagensBase64.map(async (b64, i) => toFile(await normalizar(b64), `imagem-${i}.png`, { type: "image/png" }))
  );

  const resposta = await client.images.edit({
    model: MODELO_IMAGEM,
    image: arquivos,
    prompt,
    size: "1024x1024",
    quality: QUALIDADE,
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
  return editarFoto([imagemBase64], PROMPT_TRATAMENTO);
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
    quality: QUALIDADE,
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

// Quando o dono manda um slide-exemplo, cada prompt pede pra seguir esse
// padrão visual em vez de só a descrição em texto de "cores da marca" —
// referência de imagem é bem mais precisa que descrição.
const AVISO_REFERENCIA =
  " A segunda imagem fornecida é uma referência de estilo (não é o produto) — siga o layout, as cores, a tipografia " +
  "e a composição dela o mais fielmente possível, adaptando pro produto e texto pedidos aqui.";

function listaTexto(itens: string[]): string {
  return itens.filter((i) => i.trim().length > 0).join(", ");
}

// Kit de 5 fotos pra anúncio do Mercado Livre a partir de 1 foto real do
// produto: capa, benefícios, especificações, onde aplicar e a foto tratada
// (fundo limpo). Cada slide é uma edição separada da mesma foto original —
// não inclui "antes/depois" de propósito, porque isso implicaria fabricar
// uma prova de resultado que não existe de verdade.
export async function gerarKitFotos(
  imagemBase64: string,
  dados: DadosKitFotos,
  imagemReferenciaBase64?: string
): Promise<string[]> {
  const imagens = imagemReferenciaBase64 ? [imagemBase64, imagemReferenciaBase64] : [imagemBase64];
  const sufixo = imagemReferenciaBase64 ? AVISO_REFERENCIA : "";

  const prompts = [
    `Crie uma arte de capa de anúncio de e-commerce brasileiro usando o produto da foto fornecida. Título grande e chamativo: "${dados.nomeProduto}". Subtítulo: "${dados.subtitulo}". ${dados.cores}. Produto centralizado e em destaque. ${AVISO_TEXTO}${sufixo}`,
    `Crie uma arte de e-commerce em lista mostrando os benefícios do produto da foto fornecida, com um ícone simples ao lado de cada item: ${listaTexto(dados.beneficios)}. ${dados.cores}. Produto em destaque ao lado da lista. ${AVISO_TEXTO}${sufixo}`,
    `Crie uma arte de e-commerce destacando em fonte bem grande a especificação principal "${dados.especificacaoPrincipal}", com especificações menores abaixo: ${listaTexto(dados.specsSecundarias)}. ${dados.cores}. Produto da foto fornecida em destaque. ${AVISO_TEXTO}${sufixo}`,
    `Crie uma arte de e-commerce em grade/colagem mostrando onde o produto da foto fornecida pode ser usado, com um ícone e legenda curta por item: ${listaTexto(dados.ondeAplicar)}. ${dados.cores}. Produto em destaque num canto. ${AVISO_TEXTO}${sufixo}`,
  ];

  const [slides, fotoLimpa] = await Promise.all([
    Promise.all(prompts.map((prompt) => editarFoto(imagens, prompt))),
    tratarFotoProduto(imagemBase64),
  ]);

  return [fotoLimpa, ...slides];
}
