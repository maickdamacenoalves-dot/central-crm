import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { sendText } from "./zapi.js";
import { saveMessage } from "./session.js";
import { logger } from "../utils/logger.js";

/**
 * Busca o atendente ONLINE da loja com menos conversas ativas (balanceamento).
 */
async function findAvailableAgent(storeId) {
  const agents = await prisma.agent.findMany({
    where: {
      storeId,
      isActive: true,
      isOnline: true,
    },
    include: {
      _count: {
        select: {
          conversations: {
            where: { status: { in: ["IN_PROGRESS", "WAITING_QUEUE"] } },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (agents.length === 0) return null;

  // Ordena por menor número de conversas ativas
  agents.sort((a, b) => a._count.conversations - b._count.conversations);
  return agents[0];
}

/**
 * Recebe a loja selecionada, busca atendente disponível e atribui a conversa.
 * Completa a carteirização (contact → agent).
 */
export async function dispatchToAgent({ contact, conversation, store }) {
  const agent = await findAvailableAgent(store.id);

  if (!agent) {
    // Nenhum atendente online — mantém na fila
    const waitMsg = `No momento todos os atendentes da loja ${store.name} estão ocupados. Você está na fila e será atendido em breve!`;

    const result = await sendText(contact.phone, waitMsg);

    await saveMessage({
      conversationId: conversation.id,
      direction: "OUTBOUND",
      senderType: "BOT",
      body: waitMsg,
      externalId: result?.messageId || null,
    });

    logger.info(
      { storeId: store.id, contactId: contact.id },
      "No agents online — contact queued"
    );

    return { assigned: false, agent: null, reason: "no_agents_online" };
  }

  // Carteirização completa: vincula contato ao atendente
  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      assignedAgentId: agent.id,
      isCarteirizado: true,
    },
  });

  // Invalida cache do contato
  await redis.del(`contact:${contact.phone}`);

  // Atualiza conversa: IN_PROGRESS com agentId
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      status: "IN_PROGRESS",
      agentId: agent.id,
    },
  });

  // Invalida cache da conversa
  await redis.del(`conv:active:${contact.id}`);

  // Mensagem ao cliente
  const connectMsg = `Vou te conectar com ${agent.name} da loja ${store.name}. Um momento!`;

  const result = await sendText(contact.phone, connectMsg);

  await saveMessage({
    conversationId: conversation.id,
    direction: "OUTBOUND",
    senderType: "BOT",
    body: connectMsg,
    externalId: result?.messageId || null,
  });

  logger.info(
    {
      contactId: contact.id,
      agentId: agent.id,
      agentName: agent.name,
      storeId: store.id,
    },
    "Conversation dispatched to agent (carteirização completa)"
  );

  return { assigned: true, agent };
}
