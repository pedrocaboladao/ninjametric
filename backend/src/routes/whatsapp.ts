import { Router } from "express";
import { obterStatusWhatsApp } from "../services/whatsappService";

// Tela de setup manual (não é módulo do frontend React) — o dono abre essa
// URL logado no painel, escaneia o QR uma vez, pronto. Meta-refresh em vez
// de JS pra não precisar de nenhuma dependência extra.
export const whatsappRouter = Router();

whatsappRouter.get("/", async (_req, res) => {
  const { status, qrDataUrl } = await obterStatusWhatsApp();

  const corpo =
    status === "conectado"
      ? `<p style="font-size:20px">✅ WhatsApp conectado.</p>`
      : qrDataUrl
        ? `<img src="${qrDataUrl}" alt="QR code" style="width:300px;height:300px" />
           <p>Abra o WhatsApp no celular → Aparelhos conectados → escaneie o QR acima.</p>`
        : `<p>Gerando QR code, aguarde...</p>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  ${status === "conectado" ? "" : '<meta http-equiv="refresh" content="5">'}
  <title>WhatsApp - Growth Hacker</title>
  <style>
    body { font-family: sans-serif; background: #111; color: #eee; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
  </style>
</head>
<body>
  <h2>Bot de WhatsApp — Growth Hacker</h2>
  ${corpo}
</body>
</html>`);
});
