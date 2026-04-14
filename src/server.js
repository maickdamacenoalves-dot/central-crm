import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { webhookRoutes } from "./routes/webhook.js";

const app = Fastify({ logger });

// ── Plugins ──────────────────────────────────────────
await app.register(cors, {
  origin: true,
  credentials: true,
});

await app.register(helmet, {
  contentSecurityPolicy: false,
});

await app.register(jwt, {
  secret: env.JWT_SECRET,
  sign: { expiresIn: env.JWT_EXPIRES_IN },
});

await app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
});

// ── Routes ───────────────────────────────────────────
await app.register(healthRoutes, { prefix: "/health" });
await app.register(authRoutes, { prefix: "/auth" });
await app.register(webhookRoutes, { prefix: "/webhook" });

// ── Start ────────────────────────────────────────────
try {
  await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
  app.log.info(`Server running on port ${env.API_PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export default app;
