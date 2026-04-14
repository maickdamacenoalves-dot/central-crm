import { prisma } from "../../config/database.js";
import { authorize } from "../../middleware/auth.js";

export async function dashboardRoutes(app) {
  // Todas as rotas do dashboard requerem pelo menos MANAGER
  app.addHook("onRequest", authorize("SUPER_ADMIN", "ADMIN", "MANAGER"));

  // GET /api/dashboard/overview — KPIs gerais
  app.get("/overview", async (request) => {
    const { storeId, role } = request.user;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const storeFilter = role === "MANAGER" ? { contact: { assignedStoreId: storeId } } : {};

    const [
      activeConversations,
      queueCount,
      closedToday,
      totalContacts,
      newContactsToday,
      botConversations,
    ] = await Promise.all([
      prisma.conversation.count({ where: { status: "IN_PROGRESS", ...storeFilter } }),
      prisma.conversation.count({ where: { status: "WAITING_QUEUE", ...storeFilter } }),
      prisma.conversation.count({ where: { status: "CLOSED", closedAt: { gte: today }, ...storeFilter } }),
      prisma.contact.count({ where: role === "MANAGER" ? { assignedStoreId: storeId } : {} }),
      prisma.contact.count({ where: { createdAt: { gte: today }, ...(role === "MANAGER" ? { assignedStoreId: storeId } : {}) } }),
      prisma.conversation.count({ where: { status: "BOT", ...storeFilter } }),
    ]);

    // Tempo médio de atendimento (conversas fechadas hoje)
    const closedConversations = await prisma.conversation.findMany({
      where: { status: "CLOSED", closedAt: { gte: today }, ...storeFilter },
      select: { startedAt: true, closedAt: true },
    });

    let avgResponseTimeMs = 0;
    if (closedConversations.length > 0) {
      const totalMs = closedConversations.reduce(
        (sum, c) => sum + (c.closedAt.getTime() - c.startedAt.getTime()),
        0
      );
      avgResponseTimeMs = totalMs / closedConversations.length;
    }

    return {
      activeConversations,
      queueCount,
      closedToday,
      botConversations,
      totalContacts,
      newContactsToday,
      avgResponseTimeMinutes: Math.round(avgResponseTimeMs / 60000),
    };
  });

  // GET /api/dashboard/stores — performance por loja
  app.get("/stores", async () => {
    const stores = await prisma.store.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const storeStats = await Promise.all(
      stores.map(async (store) => {
        const [active, queue, closedToday, contacts, onlineAgents] = await Promise.all([
          prisma.conversation.count({ where: { status: "IN_PROGRESS", contact: { assignedStoreId: store.id } } }),
          prisma.conversation.count({ where: { status: "WAITING_QUEUE", contact: { assignedStoreId: store.id } } }),
          prisma.conversation.count({ where: { status: "CLOSED", closedAt: { gte: today }, contact: { assignedStoreId: store.id } } }),
          prisma.contact.count({ where: { assignedStoreId: store.id } }),
          prisma.agent.count({ where: { storeId: store.id, isActive: true, isOnline: true } }),
        ]);

        return { ...store, active, queue, closedToday, contacts, onlineAgents };
      })
    );

    return { data: storeStats };
  });

  // GET /api/dashboard/agents — performance por atendente
  app.get("/agents", async (request) => {
    const { storeId, role } = request.user;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const where = { isActive: true };
    if (role === "MANAGER") where.storeId = storeId;

    const agents = await prisma.agent.findMany({
      where,
      select: {
        id: true,
        name: true,
        isOnline: true,
        storeId: true,
        store: { select: { name: true } },
      },
    });

    const agentStats = await Promise.all(
      agents.map(async (agent) => {
        const [activeConversations, closedToday, messagesToday] = await Promise.all([
          prisma.conversation.count({ where: { agentId: agent.id, status: "IN_PROGRESS" } }),
          prisma.conversation.count({ where: { agentId: agent.id, status: "CLOSED", closedAt: { gte: today } } }),
          prisma.message.count({ where: { agentId: agent.id, createdAt: { gte: today } } }),
        ]);

        return { ...agent, activeConversations, closedToday, messagesToday };
      })
    );

    return { data: agentStats };
  });

  // GET /api/dashboard/ai — métricas da IA
  app.get("/ai", async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalContexts, transferredContexts, intents] = await Promise.all([
      prisma.aiContext.count({ where: { createdAt: { gte: today } } }),
      prisma.aiContext.count({ where: { createdAt: { gte: today }, transferCount: { gt: 0 } } }),
      prisma.aiContext.groupBy({
        by: ["intent"],
        where: { createdAt: { gte: today }, intent: { not: null } },
        _count: true,
      }),
    ]);

    // Sentimento
    const sentiments = await prisma.aiContext.groupBy({
      by: ["sentiment"],
      where: { createdAt: { gte: today }, sentiment: { not: null } },
      _count: true,
    });

    // Conversas resolvidas só pelo bot (nunca foram transferidas)
    const resolvedByBot = await prisma.conversation.count({
      where: {
        status: { in: ["RESOLVED", "CLOSED"] },
        closedAt: { gte: today },
        agentId: null,
      },
    });

    return {
      totalInteractions: totalContexts,
      transferred: transferredContexts,
      resolvedByBot,
      transferRate: totalContexts > 0 ? Math.round((transferredContexts / totalContexts) * 100) : 0,
      intents: intents.map((i) => ({ intent: i.intent, count: i._count })),
      sentiments: sentiments.map((s) => ({ sentiment: s.sentiment, count: s._count })),
    };
  });
}
