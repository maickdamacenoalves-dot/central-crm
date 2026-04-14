import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { join } from "node:path";
import { env } from "./config/env.js";
import { loggerConfig } from "./utils/logger.js";
import { initSocket } from "./config/socket.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { webhookRoutes } from "./routes/webhook.js";
import { conversationRoutes } from "./routes/api/conversations.js";
import { contactRoutes } from "./routes/api/contacts.js";
import { agentRoutes } from "./routes/api/agents.js";
import { storeRoutes } from "./routes/api/stores.js";
import { dashboardRoutes } from "./routes/api/dashboard.js";
import { vhsysRoutes } from "./routes/api/vhsys.js";

const app = Fastify({ logger: loggerConfig });

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

// Serve uploads como arquivos estáticos
await app.register(fastifyStatic, {
  root: join(process.cwd(), "uploads"),
  prefix: "/uploads/",
  decorateReply: false,
});

// ── Routes ───────────────────────────────────────────
await app.register(healthRoutes, { prefix: "/health" });
await app.register(authRoutes, { prefix: "/auth" });
await app.register(webhookRoutes, { prefix: "/webhook" });

// API routes (protegidas por auth dentro de cada plugin)
await app.register(conversationRoutes, { prefix: "/api/conversations" });
await app.register(contactRoutes, { prefix: "/api/contacts" });
await app.register(agentRoutes, { prefix: "/api/agents" });
await app.register(storeRoutes, { prefix: "/api/stores" });
await app.register(dashboardRoutes, { prefix: "/api/dashboard" });
await app.register(vhsysRoutes, { prefix: "/api/vhsys" });

// ── Start ────────────────────────────────────────────
try {
  await app.listen({ port: env.API_PORT, host: "0.0.0.0" });

  // Inicializa Socket.IO no server HTTP do Fastify
  initSocket(app.server, env.JWT_SECRET);

  app.log.info(`Server running on port ${env.API_PORT}`);
  app.log.info("Socket.IO initialized");
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export default app;
