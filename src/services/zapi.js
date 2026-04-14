import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

const BASE = `${env.ZAPI_BASE_URL}/${env.ZAPI_INSTANCE_ID}/token/${env.ZAPI_INSTANCE_TOKEN}`;

const headers = {
  "Content-Type": "application/json",
  "Client-Token": env.ZAPI_CLIENT_TOKEN,
};

async function zapiRequest(endpoint, body) {
  const url = `${BASE}${endpoint}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error({ endpoint, status: res.status, text }, "Z-API request failed");
      throw new Error(`Z-API ${res.status}: ${text}`);
    }

    return res.json();
  } catch (err) {
    logger.error({ err, endpoint }, "Z-API request error");
    throw err;
  }
}

export async function sendText(phone, message) {
  return zapiRequest("/send-text", {
    phone,
    message,
  });
}

export async function sendImage(phone, imageUrl, caption = "") {
  return zapiRequest("/send-image", {
    phone,
    image: imageUrl,
    caption,
  });
}

export async function sendDocument(phone, documentUrl, fileName) {
  return zapiRequest("/send-document", {
    phone,
    document: documentUrl,
    fileName,
  });
}

export async function sendAudio(phone, audioUrl) {
  return zapiRequest("/send-audio", {
    phone,
    audio: audioUrl,
  });
}

export async function sendButtons(phone, message, buttons) {
  return zapiRequest("/send-button-list", {
    phone,
    message,
    buttonList: {
      buttons: buttons.map((b) => ({ id: b.id, label: b.label })),
    },
  });
}

export async function sendStoreSelection(phone) {
  const stores = [
    { id: "store_garopaba", label: "Central de Tintas Garopaba" },
    { id: "store_imbituba", label: "Central de Tintas Imbituba" },
    { id: "store_laguna", label: "Central de Tintas Laguna" },
    { id: "store_sw", label: "SW Garopaba" },
    { id: "store_garopaba_tintas", label: "Garopaba Tintas" },
  ];

  return sendButtons(
    phone,
    "Selecione a loja desejada:",
    stores
  );
}
