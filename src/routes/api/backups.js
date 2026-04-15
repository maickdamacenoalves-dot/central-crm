import { prisma } from "../../config/database.js";
import { authorize } from "../../middleware/auth.js";
import { backupQueue } from "../../queues/setup.js";
import { logAudit, getClientIp } from "../../services/audit.js";

export async function backupRoutes(app) {
  // GET /api/backups — lista últimos backups
  app.get("/", { preHandler: authorize("SUPER_ADMIN", "ADMIN") }, async (request) => {
    const { page = 1, limit = 20 } = request.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [data, total] = await Promise.all([
      prisma.backup.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: Number(limit),
      }),
      prisma.backup.count(),
    ]);

    // Convert BigInt fileSize to string for JSON serialization
    const serialized = data.map((b) => ({
      ...b,
      fileSize: b.fileSize?.toString() || null,
    }));

    return { data: serialized, total, page: Number(page), limit: Number(limit) };
  });

  // POST /api/backups/trigger — dispara backup manual
  app.post("/trigger", { preHandler: authorize("SUPER_ADMIN", "ADMIN") }, async (request, reply) => {
    const { type = "full" } = request.body || {};

    await backupQueue.add("manual-backup", { type }, {
      attempts: 2,
      backoff: { type: "exponential", delay: 30_000 },
    });

    await logAudit({
      actorId: request.user.id,
      action: "trigger_backup",
      resourceType: "backup",
      details: { type },
      ipAddress: getClientIp(request),
    });

    return reply.code(202).send({ message: "Backup job queued", type });
  });
}
