import { Server } from "socket.io";
import { prisma } from "./database.js";
import { redis } from "./redis.js";
import { sendText } from "../services/zapi.js";
import { saveMessage } from "../services/session.js";
import { logger } from "../utils/logger.js";

let io;

/**
 * Inicializa o Socket.IO integrado ao servidor HTTP do Fastify.
 */
export function initSocket(server, jwtSecret) {
  io = new Server(server, {
    cors: { origin: true, credentials: true },
    transports: ["websocket", "polling"],
  });

  // ── Auth middleware via JWT ─────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace("Bearer ", "");
      if (!token) return next(new Error("Authentication required"));

      // Decodifica JWT manualmente (jose-style, sem dependência extra)
      const [, payloadB64] = token.split(".");
      const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());

      // Verifica expiração
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        return next(new Error("Token expired"));
      }

      // Busca o agente
      const agent = await prisma.agent.findUnique({
        where: { id: payload.id },
        select: { id: true, name: true, storeId: true, role: true, isActive: true },
      });

      if (!agent || !agent.isActive) return next(new Error("Agent not found or inactive"));

      socket.agent = agent;
      next();
    } catch (err) {
      logger.error({ err }, "Socket auth error");
      next(new Error("Invalid token"));
    }
  });

  // ── Connection handler ─────────────────────────────
  io.on("connection", (socket) => {
    const { agent } = socket;
    logger.info({ agentId: agent.id, name: agent.name }, "Agent connected via Socket.IO");

    // Join rooms: own agent room + store room
    socket.join(`agent:${agent.id}`);
    socket.join(`store:${agent.storeId}`);

    // ── agent:connect — marca ONLINE ──────────────────
    handleAgentConnect(socket, agent);

    // ── message:send — atendente envia mensagem ───────
    socket.on("message:send", (data, ack) => handleMessageSend(socket, agent, data, ack));

    // ── conversation:transfer ─────────────────────────
    socket.on("conversation:transfer", (data, ack) => handleConversationTransfer(socket, agent, data, ack));

    // ── conversation:close ────────────────────────────
    socket.on("conversation:close", (data, ack) => handleConversationClose(socket, agent, data, ack));

    // ── agent:typing ──────────────────────────────────
    socket.on("agent:typing", (data) => {
      // Notifica o room da loja que o agente está digitando
      socket.to(`store:${agent.storeId}`).emit("agent:typing", {
        agentId: agent.id,
        agentName: agent.name,
        conversationId: data.conversationId,
        isTyping: data.isTyping,
      });
    });

    // ── disconnect ────────────────────────────────────
    socket.on("disconnect", () => handleAgentDisconnect(socket, agent));
  });

  return io;
}

/**
 * Retorna a instância do Socket.IO.
 */
export function getIO() {
  if (!io) throw new Error("Socket.IO not initialized");
  return io;
}

// ── Handlers ─────────────────────────────────────────────

async function handleAgentConnect(socket, agent) {
  try {
    await prisma.agent.update({
      where: { id: agent.id },
      data: { isOnline: true, lastLoginAt: new Date() },
    });

    // Notifica a loja que o agente ficou online
    socket.to(`store:${agent.storeId}`).emit("agent:status", {
      agentId: agent.id,
      agentName: agent.name,
      isOnline: true,
    });

    logger.info({ agentId: agent.id }, "Agent marked ONLINE");
  } catch (err) {
    logger.error({ err, agentId: agent.id }, "Error on agent connect");
  }
}

async function handleAgentDisconnect(socket, agent) {
  try {
    // Verifica se o agente tem outras conexões ativas
    const rooms = await io.in(`agent:${agent.id}`).fetchSockets();
    if (rooms.length === 0) {
      await prisma.agent.update({
        where: { id: agent.id },
        data: { isOnline: false },
      });

      socket.to(`store:${agent.storeId}`).emit("agent:status", {
        agentId: agent.id,
        agentName: agent.name,
        isOnline: false,
      });

      logger.info({ agentId: agent.id }, "Agent marked OFFLINE");
    }
  } catch (err) {
    logger.error({ err, agentId: agent.id }, "Error on agent disconnect");
  }
}

async function handleMessageSend(socket, agent, data, ack) {
  try {
    const { conversationId, body } = data;
    if (!conversationId || !body) {
      return ack?.({ error: "conversationId and body are required" });
    }

    // Busca conversa com contato
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { contact: true },
    });

    if (!conversation) return ack?.({ error: "Conversation not found" });

    // Envia via Z-API
    const zapiResult = await sendText(conversation.contact.phone, body);

    // Salva no banco como AGENT
    const message = await saveMessage({
      conversationId,
      direction: "OUTBOUND",
      senderType: "AGENT",
      body,
      agentId: agent.id,
      externalId: zapiResult?.messageId || null,
    });

    // Emite para todos no room da conversa/loja
    io.to(`store:${agent.storeId}`).emit("message:new", {
      message,
      conversationId,
      agentId: agent.id,
      agentName: agent.name,
    });

    ack?.({ success: true, message });

    logger.info({ conversationId, agentId: agent.id }, "Agent sent message");
  } catch (err) {
    logger.error({ err }, "Error sending message via socket");
    ack?.({ error: "Failed to send message" });
  }
}

async function handleConversationTransfer(socket, agent, data, ack) {
  try {
    const { conversationId, targetAgentId, targetStoreId } = data;
    if (!conversationId) return ack?.({ error: "conversationId is required" });
    if (!targetAgentId && !targetStoreId) return ack?.({ error: "targetAgentId or targetStoreId required" });

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { contact: true },
    });

    if (!conversation) return ack?.({ error: "Conversation not found" });

    const updateData = {};

    if (targetAgentId) {
      // Transferência direta para outro atendente
      const targetAgent = await prisma.agent.findUnique({ where: { id: targetAgentId } });
      if (!targetAgent) return ack?.({ error: "Target agent not found" });

      updateData.agentId = targetAgentId;
      updateData.status = "IN_PROGRESS";

      // Atualiza carteirização do contato
      await prisma.contact.update({
        where: { id: conversation.contactId },
        data: { assignedAgentId: targetAgentId, assignedStoreId: targetAgent.storeId },
      });

      // Invalida cache
      await redis.del(`contact:${conversation.contact.phone}`);

      // Notifica novo atendente
      io.to(`agent:${targetAgentId}`).emit("conversation:new", {
        conversation: { ...conversation, agentId: targetAgentId },
        transferredFrom: { id: agent.id, name: agent.name },
      });
    } else if (targetStoreId) {
      // Transferência para fila de outra loja
      updateData.agentId = null;
      updateData.status = "WAITING_QUEUE";

      await prisma.contact.update({
        where: { id: conversation.contactId },
        data: { assignedStoreId: targetStoreId, assignedAgentId: null },
      });

      await redis.del(`contact:${conversation.contact.phone}`);

      // Notifica a loja destino
      io.to(`store:${targetStoreId}`).emit("conversation:new", {
        conversation: { ...conversation, agentId: null },
        transferredFrom: { id: agent.id, name: agent.name },
      });
    }

    const updated = await prisma.conversation.update({
      where: { id: conversationId },
      data: updateData,
    });

    await redis.del(`conv:active:${conversation.contactId}`);

    ack?.({ success: true, conversation: updated });
    logger.info({ conversationId, from: agent.id, targetAgentId, targetStoreId }, "Conversation transferred");
  } catch (err) {
    logger.error({ err }, "Error transferring conversation");
    ack?.({ error: "Failed to transfer" });
  }
}

async function handleConversationClose(socket, agent, data, ack) {
  try {
    const { conversationId } = data;
    if (!conversationId) return ack?.({ error: "conversationId is required" });

    const conversation = await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: "CLOSED", closedAt: new Date() },
    });

    await redis.del(`conv:active:${conversation.contactId}`);

    // Notifica a loja
    io.to(`store:${agent.storeId}`).emit("conversation:closed", {
      conversationId,
      closedBy: { id: agent.id, name: agent.name },
    });

    ack?.({ success: true });
    logger.info({ conversationId, agentId: agent.id }, "Conversation closed");
  } catch (err) {
    logger.error({ err }, "Error closing conversation");
    ack?.({ error: "Failed to close" });
  }
}

/**
 * Emite evento de nova mensagem recebida (chamado pelo message-worker).
 */
export function emitNewMessage({ conversation, message, contact }) {
  if (!io) return;

  const targetRooms = [];
  if (conversation.agentId) targetRooms.push(`agent:${conversation.agentId}`);
  if (contact.assignedStoreId) targetRooms.push(`store:${contact.assignedStoreId}`);

  for (const room of targetRooms) {
    io.to(room).emit("message:new", {
      message,
      conversationId: conversation.id,
      contact: { id: contact.id, phone: contact.phone, name: contact.name },
    });
  }
}

/**
 * Emite evento de nova conversa atribuída a um atendente.
 */
export function emitConversationAssigned({ conversation, agent, contact }) {
  if (!io) return;

  io.to(`agent:${agent.id}`).emit("conversation:new", {
    conversation,
    contact: { id: contact.id, phone: contact.phone, name: contact.name },
  });
}
