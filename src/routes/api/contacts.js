import { z } from "zod";
import { prisma } from "../../config/database.js";
import { redis } from "../../config/redis.js";
import { authenticate } from "../../middleware/auth.js";
import { decryptContact } from "../../services/session.js";

const updateContactSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  assignedStoreId: z.string().optional(),
  assignedAgentId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function contactRoutes(app) {
  app.addHook("onRequest", authenticate);

  // GET /api/contacts — lista contatos com filtros
  app.get("/", async (request) => {
    const { role, storeId } = request.user;
    const { carteirizado, storeId: filterStore, search, page = 1, limit = 20 } = request.query;

    const where = {};

    // Filtro por loja (agents/managers veem só sua loja)
    if (role === "AGENT" || role === "MANAGER") {
      where.assignedStoreId = storeId;
    } else if (filterStore) {
      where.assignedStoreId = filterStore;
    }

    if (carteirizado !== undefined) {
      where.isCarteirizado = carteirizado === "true";
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        include: {
          assignedStore: { select: { id: true, name: true } },
          assignedAgent: { select: { id: true, name: true } },
          _count: { select: { conversations: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip,
        take: Number(limit),
      }),
      prisma.contact.count({ where }),
    ]);

    return { data: contacts, total, page: Number(page), limit: Number(limit) };
  });

  // GET /api/contacts/:id — detalhes com histórico
  app.get("/:id", async (request, reply) => {
    const contact = await prisma.contact.findUnique({
      where: { id: request.params.id },
      include: {
        assignedStore: true,
        assignedAgent: { select: { id: true, name: true, email: true } },
        conversations: {
          orderBy: { createdAt: "desc" },
          take: 10,
          include: {
            agent: { select: { id: true, name: true } },
            _count: { select: { messages: true } },
          },
        },
        aiContexts: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { summary: true, topics: true, sentiment: true, intent: true },
        },
      },
    });

    if (!contact) return reply.code(404).send({ error: "Contact not found" });

    // Decrypt sensitive fields
    return decryptContact(contact);
  });

  // PATCH /api/contacts/:id — atualizar dados
  app.patch("/:id", async (request, reply) => {
    const parsed = updateContactSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    }

    const contact = await prisma.contact.findUnique({ where: { id: request.params.id } });
    if (!contact) return reply.code(404).send({ error: "Contact not found" });

    const data = {};
    const { name, assignedStoreId, assignedAgentId, metadata } = parsed.data;
    if (name !== undefined) data.name = name;
    if (metadata !== undefined) data.metadata = metadata;
    if (assignedStoreId !== undefined) {
      data.assignedStoreId = assignedStoreId;
      data.isCarteirizado = true;
    }
    if (assignedAgentId !== undefined) {
      data.assignedAgentId = assignedAgentId;
      data.isCarteirizado = true;
    }

    const updated = await prisma.contact.update({
      where: { id: request.params.id },
      data,
    });

    // Invalida cache
    await redis.del(`contact:${contact.phone}`);

    return updated;
  });
}
