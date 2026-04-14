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
