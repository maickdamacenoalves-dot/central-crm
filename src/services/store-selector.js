import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { sendStoreSelection } from "./zapi.js";
import { saveMessage } from "./session.js";
import { logger } from "../utils/logger.js";

/**
 * Mapeamento dos IDs dos botões Z-API → IDs das lojas no banco.
 * Os IDs das lojas são gerados no seed como slug do nome.
 */
const BUTTON_TO_STORE = {
  store_garopaba: "central-de-tintas-garopaba",
  store_imbituba: "central-de-tintas-imbituba",
  store_laguna: "central-de-tintas-laguna",
  store_sw: "sw-garopaba",
  store_garopaba_tintas: "garopaba-tintas",
};

/**
 * Envia os botões interativos de seleção de loja ao cliente.
 */
export async function sendStoreButtons({ contact, conversation }) {
  const result = await sendStoreSelection(contact.phone);

  // Salva a mensagem de seleção como BOT no banco
  await saveMessage({
    conversationId: conversation.id,
    direction: "OUTBOUND",
    senderType: "BOT",
    body: "Selecione a loja desejada:",
    externalId: result?.messageId || null,
  });

  logger.info({ phone: contact.phone }, "Store selection buttons sent");
  return result;
}

/**
 * Processa a resposta do botão de seleção de loja.
 * Faz a carteirização parcial (vincula contato à loja).
 */
export async function handleStoreSelection({ contact, conversation, buttonId }) {
  const storeId = BUTTON_TO_STORE[buttonId];

  if (!storeId) {
    logger.warn({ buttonId }, "Unknown store button ID");
    return null;
  }

  // Verifica se a loja existe e está ativa
  const store = await prisma.store.findFirst({
    where: { id: storeId, isActive: true },
  });

  if (!store) {
    logger.error({ storeId }, "Store not found or inactive");
    return null;
  }

  // Carteirização: vincula contato à loja
  const updatedContact = await prisma.contact.update({
    where: { id: contact.id },
    data: {
      assignedStoreId: store.id,
      isCarteirizado: true,
    },
  });

  // Invalida cache do contato
  await redis.del(`contact:${contact.phone}`);

  // Atualiza conversa para WAITING_QUEUE
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { status: "WAITING_QUEUE" },
  });

  // Invalida cache da conversa
  await redis.del(`conv:active:${contact.id}`);

  logger.info(
    { contactId: contact.id, storeId: store.id, storeName: store.name },
    "Contact assigned to store (carteirização parcial)"
  );

  return { store, contact: updatedContact };
}
