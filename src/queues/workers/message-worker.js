import { Worker } from "bullmq";
import { redisConnection } from "../../config/redis.js";
import { routeMessage } from "../../services/message-router.js";
import { logger } from "../../utils/logger.js";

const worker = new Worker(
  "messages",
  async (job) => {
    const { phone, payload } = job.data;

    logger.info({ phone, jobId: job.id }, "Processing incoming message");

    try {
      const result = await routeMessage(payload);

      logger.info(
        {
          phone,
          route: result.route,
          conversationId: result.conversation.id,
          messageId: result.message.id,
        },
        "Message routed"
      );

      return result;
    } catch (err) {
      logger.error({ err, phone, jobId: job.id }, "Failed to process message");
      throw err;
    }
  },
  {
    connection: redisConnection,
    concurrency: 5,
    limiter: {
      max: 50,
      duration: 1000,
    },
  }
);

worker.on("completed", (job) => {
  logger.debug({ jobId: job.id }, "Job completed");
});

worker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "Job failed");
});

export default worker;
