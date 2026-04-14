import { prisma } from "../../config/database.js";
import { authenticate } from "../../middleware/auth.js";

export async function storeRoutes(app) {
  app.addHook("onRequest", authenticate);

  // GET /api/stores — lista lojas com contagem de conversas ativas
  app.get("/", async () => {
    const stores = await prisma.store.findMany({
      where: { isActive: true },
      include: {
        _count: {
          select: {
            agents: { where: { isActive: true } },
            contacts: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    // Adiciona contagem de conversas ativas por loja
    const storesWithConversations = await Promise.all(
      stores.map(async (store) => {
        const [activeConversations, queueCount, onlineAgents] = await Promise.all([
          prisma.conversation.count({
            where: {
              status: "IN_PROGRESS",
              contact: { assignedStoreId: store.id },
            },
          }),
          prisma.conversation.count({
            where: {
              status: "WAITING_QUEUE",
              contact: { assignedStoreId: store.id },
            },
          }),
          prisma.agent.count({
            where: { storeId: store.id, isActive: true, isOnline: true },
          }),
        ]);

        return {
          ...store,
          activeConversations,
          queueCount,
          onlineAgents,
        };
      })
    );

    return { data: storesWithConversations };
  });

  // GET /api/stores/:id/stats — métricas da loja
  app.get("/:id/stats", async (request, reply) => {
    const store = await prisma.store.findUnique({ where: { id: request.params.id } });
    if (!store) return reply.code(404).send({ error: "Store not found" });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalContacts,
      carteirizados,
      totalAgents,
      onlineAgents,
      activeConversations,
      queueCount,
      closedToday,
      avgMessages,
    ] = await Promise.all([
      prisma.contact.count({ where: { assignedStoreId: store.id } }),
      prisma.contact.count({ where: { assignedStoreId: store.id, isCarteirizado: true } }),
      prisma.agent.count({ where: { storeId: store.id, isActive: true } }),
      prisma.agent.count({ where: { storeId: store.id, isActive: true, isOnline: true } }),
      prisma.conversation.count({
        where: { status: "IN_PROGRESS", contact: { assignedStoreId: store.id } },
      }),
      prisma.conversation.count({
        where: { status: "WAITING_QUEUE", contact: { assignedStoreId: store.id } },
      }),
      prisma.conversation.count({
        where: {
          status: "CLOSED",
          closedAt: { gte: today },
          contact: { assignedStoreId: store.id },
        },
      }),
      prisma.message.count({
        where: {
          conversation: { contact: { assignedStoreId: store.id } },
          createdAt: { gte: today },
        },
      }),
    ]);

    return {
      store: { id: store.id, name: store.name },
      stats: {
        totalContacts,
        carteirizados,
        totalAgents,
        onlineAgents,
        activeConversations,
        queueCount,
        closedToday,
        messagesToday: avgMessages,
      },
    };
  });
}
