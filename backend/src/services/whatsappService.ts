import path from "node:path";
import { Boom } from "@hapi/boom";
import QRCode from "qrcode";
import makeWASocket, { DisconnectReason, jidNormalizedUser, proto, useMultiFileAuthState, WASocket, WAMessage } from "baileys";
import { env } from "../config/env";
import { perguntarGrowthHacker } from "./growthHackerService";

// "../../whatsapp_auth" resolve pra backend/whatsapp_auth em dev (src/services/..)
// e pra /app/whatsapp_auth em produção (dist/services/.. dentro do container,
// WORKDIR /app) — mesmo caminho montado como volume no docker-compose.yml,
// pra sessão sobreviver a "docker compose up -d --build" sem novo QR.
const PASTA_AUTH = path.join(__dirname, "../../whatsapp_auth");

export type StatusWhatsApp = "aguardando_qr" | "conectado" | "desconectado";

let qrAtual: string | null = null;
let status: StatusWhatsApp = "desconectado";

// JID(s) da própria conta conectada, descobertos com o WhatsApp já
// autenticado (connection "open") em vez de montados a partir de
// WHATSAPP_OWNER_NUMBER na mão — número brasileiro de celular pode ter o 9º
// dígito omitido no JID que o WhatsApp usa internamente (visto ao vivo: dono
// digitou "5544997120256", mas o WhatsApp identifica a conta como
// "554497120256"), e contas também podem responder tanto no formato de
// telefone (@s.whatsapp.net) quanto no formato LID (@lid) — por isso guarda
// todas as variações que o próprio socket relatar, normalizadas.
let jidsProprios = new Set<string>();

export async function obterStatusWhatsApp(): Promise<{ status: StatusWhatsApp; qrDataUrl: string | null }> {
  if (status === "aguardando_qr" && qrAtual) {
    const qrDataUrl = await QRCode.toDataURL(qrAtual);
    return { status, qrDataUrl };
  }
  return { status, qrDataUrl: null };
}

function extrairTexto(msg: proto.IMessage | undefined | null): string | null {
  if (!msg) return null;
  return msg.conversation ?? msg.extendedTextMessage?.text ?? null;
}

// O bot conecta usando o próprio número do dono (não um número dedicado à
// parte) — então a única forma de "falar com o bot" é mandando mensagem pro
// chat "Mensagem para você" do próprio WhatsApp. Nesse chat toda mensagem
// enviada do celular chega aqui com fromMe=true (é literalmente você
// mandando pra si mesmo), então NÃO dá pra usar fromMe como filtro de
// autorização — quem autoriza é o remoteJid ser o do próprio dono (só ele
// consegue escrever nesse chat). Pra não entrar em loop respondendo à
// própria resposta, guarda o id de toda mensagem que o bot manda e ignora
// se ela reaparecer num upsert.
const idsEnviadosPeloBot = new Set<string>();

async function iniciarSocket(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(PASTA_AUTH);

  const sock = makeWASocket({ auth: state });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      qrAtual = qr;
      status = "aguardando_qr";
    }

    if (connection === "open") {
      qrAtual = null;
      status = "conectado";
      jidsProprios = new Set(
        [sock.user?.id, sock.user?.phoneNumber, sock.user?.lid]
          .filter((v): v is string => !!v)
          .map((v) => jidNormalizedUser(v))
      );
      console.log(`WhatsApp: conectado. JID(s) próprio(s): ${[...jidsProprios].join(", ")}`);
    }

    if (connection === "close") {
      status = "desconectado";
      const motivo = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const deslogado = motivo === DisconnectReason.loggedOut;
      console.log(`WhatsApp: conexão fechada (motivo=${motivo}). ${deslogado ? "Sessão deslogada, não reconecta sozinho." : "Reconectando..."}`);
      if (!deslogado) {
        iniciarSocket().catch((err) => console.error("WhatsApp: falha ao reconectar:", err));
      }
    }
  });

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      processarMensagem(sock, m).catch((err) => console.error("WhatsApp: falha ao processar mensagem:", err));
    }
  });
}

async function processarMensagem(sock: WASocket, m: WAMessage): Promise<void> {
  const remetente = m.key.remoteJid ? jidNormalizedUser(m.key.remoteJid) : null;
  if (!remetente || !jidsProprios.has(remetente)) return;

  if (m.key.id && idsEnviadosPeloBot.has(m.key.id)) {
    idsEnviadosPeloBot.delete(m.key.id);
    return;
  }

  const texto = extrairTexto(m.message);
  if (!texto) return;

  const jid = m.key.remoteJid!;
  console.log(`WhatsApp: pergunta recebida de ${remetente}, consultando o Growth Hacker...`);

  try {
    await sock.sendPresenceUpdate("composing", jid);
    const { resposta } = await perguntarGrowthHacker(texto);
    const enviada = await sock.sendMessage(jid, { text: resposta });
    if (enviada?.key.id) idsEnviadosPeloBot.add(enviada.key.id);
  } catch (err) {
    console.error("WhatsApp: falha ao responder mensagem:", err);
    const erroEnviado = await sock
      .sendMessage(jid, { text: "Deu erro aqui do meu lado tentando responder — tenta de novo em instantes." })
      .catch(() => null);
    if (erroEnviado?.key.id) idsEnviadosPeloBot.add(erroEnviado.key.id);
  }
}

export function iniciarWhatsApp(): void {
  if (!env.whatsappOwnerNumber) {
    console.log("WhatsApp: WHATSAPP_OWNER_NUMBER não configurado — bot desligado.");
    return;
  }
  iniciarSocket().catch((err) => console.error("WhatsApp: falha ao iniciar conexão:", err));
}
