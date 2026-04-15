import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { logger } from "../utils/logger.js";
import { encrypt, decrypt } from "../utils/crypto.js";

const CONTACT_CACHE_TTL = 3600; // 1 hora
const CONVERSATION_CACHE_TTL = 1800; // 30 min

// ── Helpers de criptografia ─────────────────────────

function encryptField(value) {
  if (!value) return value;
  try {
    return encrypt(value);
  } catch (err) {
    logger.error({ err }, "Encryption failed, storing plaintext");
    return value;
  }
}

function decryptField(value) {
  if (!value) return value;
  try {
    return decrypt(value);
  } catch {
    // Valor pode ser plaintext (migração gradual)
    return value;
  }
}

function decryptMessage(message) {
  if (!message) return message;
  return {
    ...message,
    body: decryptField(message.body),
  };
}

function decryptContact(contact) {
  if (!contact) return contact;
  return {
    ...contact,
    document: decryptField(contact.document),
  };
}

// ── Contact ──────────────────────────────────────────

export async function findOrCreateContact(phone, name) {
  // Check cache
  const cached = await redis.get(`contact:${phone}`);
  if (cached) return JSON.parse(cached);

  let contact = await prisma.contact.findUnique({ where: { phone } });

  if (!contact) {
    contact = await prisma.contact.create({
      data: { phone, name },
    });
    logger.info({ phone, id: contact.id }, "New contact created");
  } else if (name && !contact.name) {
    contact = await prisma.contact.update({
      where: { id: contact.id },
      data: { name },
    });
  }

  await redis.set(`contact:${phone}`, JSON.stringify(contact), "EX", CONTACT_CACHE_TTL);
  return contact;
}

// ── Conversation ─────────────────────────────────────

export async function getActiveConversation(contactId) {
  const cacheKey = `conv:active:${contactId}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const conversation = await prisma.conversation.findFirst({
    where: {
      contactId,
      status: { in: ["BOT", "WAITING_QUEUE", "IN_PROGRESS"] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (conversation) {
    await redis.set(cacheKey, JSON.stringify(conversation), "EX", CONVERSATION_CACHE_TTL);
  }

  return conversation;
}

export async function createConversation(contactId, agentId = null) {
  const conversation = await prisma.conversation.create({
    data: {
      contactId,
      agentId,
      status: "BOT",
    },
  });

  await redis.set(
    `conv:active:${contactId}`,
    JSON.stringify(conversation),
    "EX",
    CONVERSATION_CACHE_TTL
  );

  logger.info({ contactId, conversationId: conversation.id }, "New conversation created");
  return conversation;
}

// ── Message ──────────────────────────────────────────

export async function saveMessage({
  conversationId,
  direction,
  body,
  externalId,
  agentId = null,
  senderType = "CUSTOMER",
  mediaUrl,
  mediaType,
  mimeType,
  fileName,
}) {
  // Encrypt message body before saving
  const encryptedBody = encryptField(body);

  const message = await prisma.message.create({
    data: {
      conversationId,
      direction,
      body: encryptedBody,
      externalId,
      agentId,
      senderType,
      mediaAttachments: mediaUrl
        ? {
            create: {
              type: mediaType,
              url: mediaUrl,
              mimeType,
              fileName,
            },
          }
        : undefined,
    },
    include: { mediaAttachments: true },
  });

  // Return decrypted body for downstream consumers
  return decryptMessage(message);
}

// ── Funções de leitura com descriptografia ───────────

export async function getConversationMessages(conversationId) {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    include: { mediaAttachments: true },
    orderBy: { timestamp: "asc" },
  });

  return messages.map(decryptMessage);
}

export async function getContactWithDecryption(contactId) {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
  });

  return decryptContact(contact);
}

export { decryptMessage, decryptContact, decryptField, encryptField };
