import { prisma } from "../config/database.js";
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
    // Z-API envia buttonId quando o cliente clica num botão interativo
    buttonId: raw.buttonId || raw.listResponseButtonId || null,
  };
}

/**
 * Roteia a mensagem recebida.
 * Retorna: { route: "BOT" | "AGENT" | "QUEUE", contact, conversation, message, normalized }
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

  // 4. Detecta BUTTON_RESPONSE de seleção de loja
  if (normalized.buttonId && normalized.buttonId.startsWith("store_")) {
    logger.info({ phone: normalized.phone, buttonId: normalized.buttonId }, "Store button response → STORE_SELECT");
    return { route: "STORE_SELECT", contact, conversation, message, normalized };
  }

  // 5. Decide rota
  let route;

  // Fast path: contato carteirizado com agente atribuído
  if (contact.isCarteirizado && contact.assignedAgentId) {
    // Verifica se o agente está online
    const agent = await prisma.agent.findUnique({
      where: { id: contact.assignedAgentId },
      select: { isOnline: true, isActive: true },
    });

    if (agent?.isActive && agent?.isOnline) {
      // Agente ONLINE → direto pro agente (pula IA)
      route = "AGENT";
      logger.info({ phone: normalized.phone, agentId: contact.assignedAgentId }, "Fast path: carteirizado + agent ONLINE → AGENT");
    } else if (contact.assignedStoreId) {
      // Agente OFFLINE → QUEUE na loja carteirizada
      route = "QUEUE";

      // Garante que conversa está em WAITING_QUEUE
      if (conversation.status === "BOT") {
        conversation = await prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: "WAITING_QUEUE" },
        });
      }

      logger.info({ phone: normalized.phone, storeId: contact.assignedStoreId }, "Carteirizado + agent OFFLINE → QUEUE");
    } else {
      route = "BOT";
      logger.info({ phone: normalized.phone }, "Carteirizado sem loja → BOT");
    }
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
  // Default: bot (cliente novo ou não carteirizado)
  else {
    route = "BOT";
    logger.info({ phone: normalized.phone }, "Default → BOT");
  }

  return { route, contact, conversation, message, normalized };
}
