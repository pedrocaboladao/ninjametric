import path from "node:path";
import { Boom } from "@hapi/boom";
import QRCode from "qrcode";
import makeWASocket, { DisconnectReason, proto, S_WHATSAPP_NET, useMultiFileAuthState, WASocket, WAMessage } from "baileys";
import { env } from "../config/env";
import { perguntarGrowthHacker } from "./growthHackerService";

// "../../whatsapp_auth" resolve pra backend/whatsapp_auth em dev (src/services/..)
// e pra /app/whatsapp_auth em produção (dist/services/.. dentro do container,
// WORKDIR /app) — mesmo caminho montado como volume no docker-compose.yml,
// pra sessão sobreviver a "docker compose up -d --build" sem novo QR.
const PASTA_AUTH = path.join(__dirname, "../../whatsapp_auth");

const JID_DONO = `${env.whatsappOwnerNumber}${S_WHATSAPP_NET}`;

export type StatusWhatsApp = "aguardando_qr" | "conectado" | "desconectado";

let qrAtual: string | null = null;
let status: StatusWhatsApp = "desconectado";

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
      console.log("WhatsApp: conectado.");
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
  if (m.key.fromMe) return;
  if (m.key.remoteJid !== JID_DONO) return;

  const texto = extrairTexto(m.message);
  if (!texto) return;

  const jid = m.key.remoteJid;

  try {
    await sock.sendPresenceUpdate("composing", jid);
    const { resposta } = await perguntarGrowthHacker(texto);
    await sock.sendMessage(jid, { text: resposta });
  } catch (err) {
    console.error("WhatsApp: falha ao responder mensagem:", err);
    await sock.sendMessage(jid, { text: "Deu erro aqui do meu lado tentando responder — tenta de novo em instantes." }).catch(() => {});
  }
}

export function iniciarWhatsApp(): void {
  iniciarSocket().catch((err) => console.error("WhatsApp: falha ao iniciar conexão:", err));
}
