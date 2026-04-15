import { z } from "zod";
import { prisma } from "../../config/database.js";
import { redis } from "../../config/redis.js";
import { authenticate } from "../../middleware/auth.js";
import { getIO } from "../../config/socket.js";
import { logger } from "../../utils/logger.js";
import { logAudit, getClientIp } from "../../services/audit.js";
import { decryptMessage } from "../../services/session.js";

const transferSchema = z.object({
  targetAgentId: z.string().uuid().optional(),
  targetStoreId: z.string().optional(),
}).refine((d) => d.targetAgentId || d.targetStoreId, {
  message: "targetAgentId or targetStoreId required",
});

export async function conversationRoutes(app) {
  app.addHook("onRequest", authenticate);

  // GET /api/conversations — lista conversas do atendente (ou todas se admin)
  app.get("/", async (request) => {
    const { id: agentId, role, storeId } = request.user;
    const { status, page = 1, limit = 20 } = request.query;

    const where = {};

    if (status) where.status = status;

    // Agents veem apenas suas conversas; Admin/Manager veem da loja; Super vê tudo
    if (role === "AGENT") {
      where.agentId = agentId;
    } else if (role === "MANAGER" || role === "ADMIN") {
      where.contact = { assignedStoreId: storeId };
    }
    // SUPER_ADMIN: sem filtro

    const skip = (Number(page) - 1) * Number(limit);

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          contact: { select: { id: true, phone: true, name: true, profilePicUrl: true, assignedStoreId: true } },
          agent: { select: { id: true, name: true } },
          _count: { select: { messages: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip,
        take: Number(limit),
      }),
      prisma.conversation.count({ where }),
    ]);

    return { data: conversations, total, page: Number(page), limit: Number(limit) };
  });

  // GET /api/conversations/:id — detalhes com mensagens
  app.get("/:id", async (request, reply) => {
    const conversation = await prisma.conversation.findUnique({
      where: { id: request.params.id },
      include: {
        contact: true,
        agent: { select: { id: true, name: true, email: true } },
        messages: {
          include: { mediaAttachments: true },
          orderBy: { timestamp: "asc" },
        },
      },
    });

    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });

    // Decrypt message bodies
    conversation.messages = conversation.messages.map(decryptMessage);

    return conversation;
  });

  // PATCH /api/conversations/:id/close — encerrar
  app.patch("/:id/close", async (request, reply) => {
    const { id: agentId } = request.user;

    const conversation = await prisma.conversation.findUnique({
      where: { id: request.params.id },
    });

    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });

    const updated = await prisma.conversation.update({
      where: { id: request.params.id },
      data: { status: "CLOSED", closedAt: new Date() },
    });

    await redis.del(`conv:active:${conversation.contactId}`);

    await logAudit({
      actorId: agentId,
      action: "close_conversation",
      resourceType: "conversation",
      resourceId: updated.id,
      ipAddress: getClientIp(request),
    });

    try {
      const io = getIO();
      io.to(`store:${request.user.storeId}`).emit("conversation:closed", {
        conversationId: updated.id,
        closedBy: { id: agentId, name: request.user.name },
      });
    } catch { /* socket not initialized */ }

    return updated;
  });

  // PATCH /api/conversations/:id/transfer — transferir
  app.patch("/:id/transfer", async (request, reply) => {
    const parsed = transferSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }

    const { targetAgentId, targetStoreId } = parsed.data;

    const conversation = await prisma.conversation.findUnique({
      where: { id: request.params.id },
      include: { contact: true },
    });

    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });

    const updateData = {};

    if (targetAgentId) {
      const targetAgent = await prisma.agent.findUnique({ where: { id: targetAgentId } });
      if (!targetAgent) return reply.code(404).send({ error: "Target agent not found" });

      updateData.agentId = targetAgentId;
      updateData.status = "IN_PROGRESS";

      await prisma.contact.update({
        where: { id: conversation.contactId },
        data: { assignedAgentId: targetAgentId, assignedStoreId: targetAgent.storeId },
      });
    } else {
      updateData.agentId = null;
      updateData.status = "WAITING_QUEUE";

      await prisma.contact.update({
        where: { id: conversation.contactId },
        data: { assignedStoreId: targetStoreId, assignedAgentId: null },
      });
    }

    await redis.del(`contact:${conversation.contact.phone}`);
    await redis.del(`conv:active:${conversation.contactId}`);

    const updated = await prisma.conversation.update({
      where: { id: request.params.id },
      data: updateData,
      include: { contact: true, agent: true },
    });

    await logAudit({
      actorId: request.user.id,
      action: "transfer_conversation",
      resourceType: "conversation",
      resourceId: updated.id,
      details: { targetAgentId, targetStoreId },
      ipAddress: getClientIp(request),
    });

    try {
      const io = getIO();
      const room = targetAgentId ? `agent:${targetAgentId}` : `store:${targetStoreId}`;
      io.to(room).emit("conversation:new", {
        conversation: updated,
        transferredFrom: { id: request.user.id, name: request.user.name },
      });
    } catch { /* socket not initialized */ }

    return updated;
  });
}
