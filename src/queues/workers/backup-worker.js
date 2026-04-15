import { Worker } from "bullmq";
import { redisConnection } from "../../config/redis.js";
import { runBackup } from "../../services/backup.js";
import { logger } from "../../utils/logger.js";

const worker = new Worker(
  "backups",
  async (job) => {
    let { type } = job.data;

    // Scheduled jobs: FULL on Sundays, INCREMENTAL on other days
    if (!type) {
      const dayOfWeek = new Date().getDay(); // 0 = Sunday
      type = dayOfWeek === 0 ? "full" : "incremental";
    }

    logger.info({ jobId: job.id, type }, "Starting backup job");

    const backupId = await runBackup(type);
    return { backupId };
  },
  {
    connection: redisConnection,
    concurrency: 1,
    limiter: { max: 1, duration: 60_000 },
  }
);

worker.on("completed", (job, result) => {
  logger.info({ jobId: job.id, result }, "Backup job completed");
});

worker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, "Backup job failed");
});

export default worker;
