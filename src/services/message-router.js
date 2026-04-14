import { findOrCreateContact, getActiveConversation, createConversation, saveMessage } from "./session.js";
import { logger } from "../utils/logger.js";

/**
 * Normaliza o payload bruto da Z-API em formato interno.
 */
function normalizePayload(raw) {
  return {
    phone: raw.phone || raw.chatId?.replace("@c.us", ""),
    name: raw.senderName || raw.chatName || null,
    body: raw.text?.message || raw.body || raw.caption || null,
    type: raw.type || "chat",
    externalId: raw.messageId || raw.id?.id || null,
    hasMedia: Boolean(raw.image || raw.audio || raw.video || raw.document || raw.sticker),
    mediaUrl: raw.image?.imageUrl || raw.audio?.audioUrl || raw.video?.videoUrl || raw.document?.documentUrl || null,
    mediaType: raw.image ? "IMAGE" : raw.audio ? "AUDIO" : raw.video ? "VIDEO" : raw.document ? "DOCUMENT" : raw.sticker ? "STICKER" : null,
    mimeType: raw.image?.mimetype || raw.audio?.mimetype || raw.video?.mimetype || raw.document?.mimetype || null,
    fileName: raw.document?.fileName || null,
    timestamp: raw.mompimnent || new Date().toISOString(),
  };
}

/**
 * Roteia a mensagem recebida.
 * Retorna: { route: "BOT" | "AGENT" | "QUEUE", contact, conversation, message }
 */
export async function routeMessage(rawPayload) {
  const normalized = normalizePayload(rawPayload);

  // 1. Identifica ou cria contato
  const contact = await findOrCreateContact(normalized.phone, normalized.name);

  // 2. Busca conversa ativa ou cria nova
  let conversation = await getActiveConversation(contact.id);
  if (!conversation) {
    conversation = await createConversation(contact.id);
  }

  // 3. Salva mensagem
  const message = await saveMessage({
    conversationId: conversation.id,
    direction: "INBOUND",
    body: normalized.body,
    externalId: normalized.externalId,
    mediaUrl: normalized.mediaUrl,
    mediaType: normalized.mediaType,
    mimeType: normalized.mimeType,
    fileName: normalized.fileName,
  });

  // 4. Decide rota
  let route;

  // Fast path: contato carteirizado com agente ativo → direto pro agente
  if (contact.isCarteirizado && contact.assignedAgentId) {
    route = "AGENT";
    logger.info({ phone: normalized.phone, agentId: contact.assignedAgentId }, "Fast path → AGENT");
  }
  // Conversa já em atendimento humano
  else if (conversation.status === "IN_PROGRESS" && conversation.agentId) {
    route = "AGENT";
    logger.info({ phone: normalized.phone }, "Active conversation → AGENT");
  }
  // Fila de espera
  else if (conversation.status === "WAITING_QUEUE") {
    route = "QUEUE";
    logger.info({ phone: normalized.phone }, "Waiting queue → QUEUE");
  }
  // Default: bot
  else {
    route = "BOT";
    logger.info({ phone: normalized.phone }, "Default → BOT");
  }

  return { route, contact, conversation, message, normalized };
}
