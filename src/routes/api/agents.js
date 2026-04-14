import { prisma } from "../../config/database.js";
import bcrypt from "bcryptjs";
import { authenticate, authorize } from "../../middleware/auth.js";

export async function agentRoutes(app) {
  // GET /api/agents — lista atendentes (admin+)
  app.get("/", { preHandler: authorize("SUPER_ADMIN", "ADMIN", "MANAGER") }, async (request) => {
    const { role, storeId } = request.user;
    const { storeId: filterStore, isOnline } = request.query;

    const where = { isActive: true };

    // Managers veem só sua loja
    if (role === "MANAGER") {
      where.storeId = storeId;
    } else if (filterStore) {
      where.storeId = filterStore;
    }

    if (isOnline !== undefined) {
      where.isOnline = isOnline === "true";
    }

    const agents = await prisma.agent.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isOnline: true,
        lastLoginAt: true,
        storeId: true,
        store: { select: { id: true, name: true } },
        _count: {
          select: {
            conversations: { where: { status: { in: ["IN_PROGRESS", "WAITING_QUEUE"] } } },
          },
        },
      },
      orderBy: { name: "asc" },
    });

    return { data: agents };
  });

  // POST /api/agents — criar atendente (admin+)
  app.post("/", { preHandler: authorize("SUPER_ADMIN", "ADMIN") }, async (request, reply) => {
    const { name, email, password, role = "AGENT", storeId } = request.body || {};

    if (!name || !email || !password || !storeId) {
      return reply.code(400).send({ error: "name, email, password, and storeId are required" });
    }

    const existing = await prisma.agent.findUnique({ where: { email } });
    if (existing) return reply.code(409).send({ error: "Email already in use" });

    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) return reply.code(404).send({ error: "Store not found" });

    const passwordHash = await bcrypt.hash(password, 12);

    const agent = await prisma.agent.create({
      data: { name, email, passwordHash, role, storeId },
      select: { id: true, name: true, email: true, role: true, storeId: true, createdAt: true },
    });

    return reply.code(201).send(agent);
  });

  // PATCH /api/agents/:id — atualizar atendente (admin+)
  app.patch("/:id", { preHandler: authorize("SUPER_ADMIN", "ADMIN") }, async (request, reply) => {
    const { name, email, role, storeId, isActive } = request.body || {};

    const agent = await prisma.agent.findUnique({ where: { id: request.params.id } });
    if (!agent) return reply.code(404).send({ error: "Agent not found" });

    const data = {};
    if (name !== undefined) data.name = name;
    if (email !== undefined) data.email = email;
    if (role !== undefined) data.role = role;
    if (storeId !== undefined) data.storeId = storeId;
    if (isActive !== undefined) data.isActive = isActive;

    const updated = await prisma.agent.update({
      where: { id: request.params.id },
      data,
      select: { id: true, name: true, email: true, role: true, storeId: true, isActive: true, isOnline: true },
    });

    return updated;
  });

  // PATCH /api/agents/:id/status — mudar status online/offline
  app.patch("/:id/status", { preHandler: authenticate }, async (request, reply) => {
    const { isOnline } = request.body || {};

    // Agente só pode mudar seu próprio status (a menos que admin)
    if (request.user.role === "AGENT" && request.params.id !== request.user.id) {
      return reply.code(403).send({ error: "Cannot change other agent's status" });
    }

    if (typeof isOnline !== "boolean") {
      return reply.code(400).send({ error: "isOnline (boolean) is required" });
    }

    const updated = await prisma.agent.update({
      where: { id: request.params.id },
      data: { isOnline },
      select: { id: true, name: true, isOnline: true },
    });

    return updated;
  });
}
