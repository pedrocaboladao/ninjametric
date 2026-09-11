import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { chamarApiAssinada } from "./shopeeAuth";

// Piloto: só a Catedral. Sem revisão humana antes do envio (decisão
// explícita do dono, por causa do prazo de 5h da Shopee) — expandir pra
// outras lojas só depois de validar esse piloto. Mesmo padrão de escopo
// fixo em array que os outros agentes já usam (ver LOJAS_AGENTE em
// agenteAdsService.ts/agenteCriacaoAdsService.ts).
const LOJAS_CHAT_AUTOMATICO = [2];

const MODELO_IA = "claude-sonnet-5";

let clienteAnthropic: Anthropic | null | undefined;
function obterClienteAnthropic(): Anthropic | null {
  if (clienteAnthropic === undefined) {
    clienteAnthropic = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;
  }
  return clienteAnthropic;
}

interface ConversaShopee {
  conversation_id: string;
  to_id: number;
  to_name: string;
  unread_count: number;
  latest_message_id: string;
  latest_message_type: string;
  latest_message_content?: { text?: string };
  latest_message_from_id: number;
}

interface RespostaListaConversas {
  error?: string;
  message?: string;
  response?: { conversations?: ConversaShopee[] };
}

// Só responde texto puro por enquanto — imagem, produto compartilhado etc.
// ficam de fora do automático (não têm um jeito óbvio de virar prompt de
// texto pra IA nessa primeira versão).
async function listarConversasPendentes(lojaId: number): Promise<ConversaShopee[]> {
  const data = await chamarApiAssinada<RespostaListaConversas>(lojaId, "/api/v2/sellerchat/get_conversation_list", {
    type: "all",
    direction: "latest",
    page_size: 20,
  });
  if (data.error) {
    throw new Error(`Shopee respondeu "${data.error}": ${data.message ?? ""}`);
  }
  const conversas = data.response?.conversations ?? [];
  // latest_message_from_id === to_id significa que quem mandou a última
  // mensagem foi o CLIENTE (to_id é sempre o id do comprador na conversa) —
  // ou seja, ainda não respondemos. Não depende de conhecer o id da loja.
  return conversas.filter(
    (c) => c.unread_count > 0 && c.latest_message_type === "text" && c.latest_message_from_id === c.to_id
  );
}

async function jaRespondida(conversationId: string, mensagemId: string): Promise<boolean> {
  const { rows } = await pool.query(
    "SELECT 1 FROM shopee_chat_ia_historico WHERE conversation_id = $1 AND mensagem_id = $2",
    [conversationId, mensagemId]
  );
  return rows.length > 0;
}

async function gerarResposta(mensagemCliente: string): Promise<string | null> {
  const client = obterClienteAnthropic();
  if (!client) return null;

  try {
    const resposta = await client.messages.create({
      model: MODELO_IA,
      max_tokens: 400,
      system: `Você é o atendimento por chat de uma loja de tintas e material de construção que vende na Shopee, respondendo direto ao comprador.

Regras:
- SEMPRE responda alguma coisa — nunca devolva uma resposta vazia. A Shopee exige resposta em até 5 horas, então mesmo sem certeza total você precisa mandar algo útil.
- Se não tiver certeza de um dado técnico específico (cor exata, prazo, compatibilidade, disponibilidade), NUNCA invente — nesse caso, peça mais detalhes ou diga que vai confirmar e retornar em breve, mas ainda assim responda de forma cordial e específica ao que foi perguntado.
- Português, tom de conversa (pode cumprimentar e se despedir, ao contrário de uma resposta seca de FAQ).
- Seja breve — no máximo 2-3 frases.`,
      messages: [{ role: "user", content: mensagemCliente }],
    });

    console.log(
      `Chat automático Shopee (IA): ${resposta.usage.input_tokens} tokens de entrada, ${resposta.usage.output_tokens} de saída.`
    );

    const texto = resposta.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return texto || null;
  } catch (err) {
    console.error("shopeeChatAutoService: falha ao gerar resposta:", err);
    return null;
  }
}

async function enviarMensagem(lojaId: number, toId: number, texto: string): Promise<void> {
  const data = await chamarApiAssinada<{ error?: string; message?: string }>(
    lojaId,
    "/api/v2/sellerchat/send_message",
    { to_id: toId, message_type: "text", content: { text: texto } },
    "POST"
  );
  if (data.error) {
    throw new Error(`Shopee respondeu "${data.error}": ${data.message ?? ""}`);
  }
}

export async function verificarConversasPendentes(lojaId: number): Promise<{ respondidas: number; falhas: number }> {
  let respondidas = 0;
  let falhas = 0;

  const conversas = await listarConversasPendentes(lojaId);
  for (const conversa of conversas) {
    try {
      const mensagemCliente = conversa.latest_message_content?.text?.trim();
      if (!mensagemCliente) continue;
      if (await jaRespondida(conversa.conversation_id, conversa.latest_message_id)) continue;

      const respostaIA = await gerarResposta(mensagemCliente);
      if (!respostaIA) {
        falhas++;
        continue;
      }

      await enviarMensagem(lojaId, conversa.to_id, respostaIA);
      await pool.query(
        `INSERT INTO shopee_chat_ia_historico (loja_id, conversation_id, mensagem_id, cliente_nome, mensagem_cliente, resposta_enviada)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [lojaId, conversa.conversation_id, conversa.latest_message_id, conversa.to_name, mensagemCliente, respostaIA]
      );
      respondidas++;
    } catch (err) {
      console.error(`Chat automático Shopee (loja ${lojaId}, conversa ${conversa.conversation_id}): falha, pulando:`, err);
      falhas++;
    }
  }

  return { respondidas, falhas };
}

// Chamada tanto pelo scheduler quanto pela rota manual ("Verificar agora") —
// mesmo padrão de verificarAgenteCriacaoAds.
export async function verificarChatShopeeTodasLojas(): Promise<{ respondidas: number; falhas: number }> {
  if (!obterClienteAnthropic()) {
    console.error("Chat automático Shopee: ANTHROPIC_API_KEY não configurada — rodada pulada.");
    return { respondidas: 0, falhas: 0 };
  }

  let respondidas = 0;
  let falhas = 0;
  for (const lojaId of LOJAS_CHAT_AUTOMATICO) {
    try {
      const resultado = await verificarConversasPendentes(lojaId);
      respondidas += resultado.respondidas;
      falhas += resultado.falhas;
    } catch (err) {
      console.error(`Chat automático Shopee (loja ${lojaId}): falha na checagem, loja pulada nessa rodada:`, err);
      falhas++;
    }
  }
  return { respondidas, falhas };
}

export interface RespostaChatHistorico {
  id: number;
  lojaId: number | null;
  lojaNome: string | null;
  conversationId: string;
  clienteNome: string | null;
  mensagemCliente: string;
  respostaEnviada: string;
  criadoEm: string;
}

export async function listarHistoricoChatShopee(limite = 50): Promise<RespostaChatHistorico[]> {
  const { rows } = await pool.query<{
    id: number;
    loja_id: number | null;
    loja_nome: string | null;
    conversation_id: string;
    cliente_nome: string | null;
    mensagem_cliente: string;
    resposta_enviada: string;
    criado_em: string;
  }>(
    `SELECT h.id, h.loja_id, l.nome AS loja_nome, h.conversation_id, h.cliente_nome,
            h.mensagem_cliente, h.resposta_enviada, h.criado_em
     FROM shopee_chat_ia_historico h
     LEFT JOIN lojas l ON l.id = h.loja_id
     ORDER BY h.criado_em DESC
     LIMIT $1`,
    [limite]
  );
  return rows.map((r) => ({
    id: r.id,
    lojaId: r.loja_id,
    lojaNome: r.loja_nome,
    conversationId: r.conversation_id,
    clienteNome: r.cliente_nome,
    mensagemCliente: r.mensagem_cliente,
    respostaEnviada: r.resposta_enviada,
    criadoEm: r.criado_em,
  }));
}

// Prazo é de HORAS (5h), não de dias como os outros agentes — checagem bem
// mais frequente. Volume baixo (1 loja, poucas conversas simultâneas), então
// 5 em 5 minutos não pesa na API da Shopee.
const INTERVALO_CHECAGEM_MS = 5 * 60 * 1000;

export function iniciarAutoRespostaChatShopee(): void {
  setInterval(async () => {
    try {
      const resultado = await verificarChatShopeeTodasLojas();
      if (resultado.respondidas > 0 || resultado.falhas > 0) {
        console.log(`Chat automático Shopee: ${resultado.respondidas} respondida(s), ${resultado.falhas} falha(s).`);
      }
    } catch (err) {
      console.error("Erro na verificação do chat automático da Shopee:", err);
    }
  }, INTERVALO_CHECAGEM_MS);
}
