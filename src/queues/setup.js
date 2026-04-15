import { Queue } from "bullmq";
import { redisConnection } from "../config/redis.js";

export const messageQueue = new Queue("messages", {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export const sendMessageQueue = new Queue("send-messages", {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export const mediaQueue = new Queue("media", {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 2000 },
  },
});

export const backupQueue = new Queue("backups", {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  },
});

// Schedule repeatable backup job: daily at 2 AM
// Sundays = FULL, other days = INCREMENTAL
backupQueue.add(
  "scheduled-backup",
  {},
  {
    repeat: { pattern: "0 2 * * *" },
    jobId: "daily-backup",
  }
).catch(() => {
  // Queue might not be ready yet on first import
});
