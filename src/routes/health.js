import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";

export async function healthRoutes(app) {
  app.get("/", async () => {
    const checks = { api: "ok", postgres: "ok", redis: "ok" };

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      checks.postgres = "error";
    }

    try {
      await redis.ping();
    } catch {
      checks.redis = "error";
    }

    const healthy = Object.values(checks).every((v) => v === "ok");

    return {
      status: healthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      checks,
    };
  });
}
