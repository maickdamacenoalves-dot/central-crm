import { messageQueue } from "../queues/setup.js";
import { logger } from "../utils/logger.js";

export async function webhookRoutes(app) {
  // POST /webhook/zapi — recebe mensagens da Z-API
  app.post("/zapi", {
    config: { rateLimit: { max: 300, timeWindow: "1 minute" } },
    handler: async (request, reply) => {
      const payload = request.body;

      // Ignora mensagens enviadas por nós
      if (payload.isFromMe) {
        return reply.code(200).send({ status: "ignored", reason: "isFromMe" });
      }

      // Ignora mensagens de grupo
      if (payload.isGroup || payload.chatId?.includes("@g.us")) {
        return reply.code(200).send({ status: "ignored", reason: "group" });
      }

      // Valida se tem phone
      const phone = payload.phone || payload.chatId?.replace("@c.us", "");
      if (!phone) {
        logger.warn({ payload }, "Webhook payload without phone");
        return reply.code(400).send({ error: "Missing phone" });
      }

      // Enfileira no BullMQ
      await messageQueue.add(
        "incoming",
        {
          phone,
          payload,
          receivedAt: new Date().toISOString(),
        },
        {
          attempts: 3,
          backoff: { type: "exponential", delay: 2000 },
        }
      );

      logger.info({ phone }, "Message enqueued");

      return reply.code(200).send({ status: "queued" });
    },
  });
}
