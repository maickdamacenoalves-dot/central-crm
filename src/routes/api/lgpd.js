import { prisma } from "../../config/database.js";
import { authorize } from "../../middleware/auth.js";
import { logAudit, getClientIp } from "../../services/audit.js";
import { decrypt } from "../../utils/crypto.js";
import { logger } from "../../utils/logger.js";

function tryDecrypt(value) {
  if (!value) return value;
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}

export async function lgpdRoutes(app) {
  // GET /api/lgpd/export/:contactId — exporta todos os dados do contato
  app.get("/export/:contactId", { preHandler: authorize("SUPER_ADMIN", "ADMIN") }, async (request, reply) => {
    const { contactId } = request.params;

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      include: {
        conversations: {
          include: {
            messages: {
              include: { mediaAttachments: true },
              orderBy: { timestamp: "asc" },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        aiContexts: true,
      },
    });

    if (!contact) return reply.code(404).send({ error: "Contact not found" });

    // Decrypt sensitive fields
    const exportData = {
      contact: {
        id: contact.id,
        phone: contact.phone,
        name: contact.name,
        document: tryDecrypt(contact.document),
        profilePicUrl: contact.profilePicUrl,
        assignedStoreId: contact.assignedStoreId,
        assignedAgentId: contact.assignedAgentId,
        isCarteirizado: contact.isCarteirizado,
        metadata: contact.metadata,
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt,
      },
      conversations: contact.conversations.map((conv) => ({
        id: conv.id,
        status: conv.status,
        subject: conv.subject,
        startedAt: conv.startedAt,
        closedAt: conv.closedAt,
        messages: conv.messages.map((msg) => ({
          id: msg.id,
          direction: msg.direction,
          channel: msg.channel,
          senderType: msg.senderType,
          body: tryDecrypt(msg.body),
          timestamp: msg.timestamp,
          mediaAttachments: msg.mediaAttachments.map((ma) => ({
            type: ma.type,
            url: ma.url,
            fileName: ma.fileName,
          })),
        })),
      })),
      aiContexts: contact.aiContexts.map((ctx) => ({
        summary: ctx.summary,
        topics: ctx.topics,
        sentiment: ctx.sentiment,
        intent: ctx.intent,
      })),
      exportedAt: new Date().toISOString(),
    };

    await logAudit({
      actorId: request.user.id,
      action: "export_data",
      resourceType: "contact",
      resourceId: contactId,
      ipAddress: getClientIp(request),
    });

    return exportData;
  });

  // DELETE /api/lgpd/forget/:contactId — anonimiza dados do contato
  app.delete("/forget/:contactId", { preHandler: authorize("SUPER_ADMIN") }, async (request, reply) => {
    const { contactId } = request.params;

    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) return reply.code(404).send({ error: "Contact not found" });

    // Anonymize contact data
    const anonymizedPhone = `deleted_${contact.id.slice(0, 8)}`;
    await prisma.contact.update({
      where: { id: contactId },
      data: {
        phone: anonymizedPhone,
        name: "[REMOVIDO POR LGPD]",
        document: null,
        profilePicUrl: null,
        metadata: null,
        assignedAgentId: null,
        isCarteirizado: false,
      },
    });

    // Anonymize message bodies
    const conversations = await prisma.conversation.findMany({
      where: { contactId },
      select: { id: true },
    });
    const conversationIds = conversations.map((c) => c.id);

    if (conversationIds.length > 0) {
      await prisma.message.updateMany({
        where: { conversationId: { in: conversationIds } },
        data: { body: "[REMOVIDO POR LGPD]" },
      });
    }

    // Delete AI contexts
    await prisma.aiContext.deleteMany({ where: { contactId } });

    // Close open conversations
    await prisma.conversation.updateMany({
      where: {
        contactId,
        status: { in: ["BOT", "WAITING_QUEUE", "IN_PROGRESS"] },
      },
      data: { status: "CLOSED", closedAt: new Date() },
    });

    await logAudit({
      actorId: request.user.id,
      action: "forget_contact",
      resourceType: "contact",
      resourceId: contactId,
      details: { originalPhone: contact.phone },
      ipAddress: getClientIp(request),
    });

    logger.info({ contactId }, "Contact data anonymized (LGPD forget)");

    return { message: "Contact data anonymized successfully" };
  });
}
