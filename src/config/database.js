import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger.js";

export const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === "development"
      ? [
          { emit: "event", level: "query" },
          { emit: "event", level: "error" },
        ]
      : [{ emit: "event", level: "error" }],
});

prisma.$on("error", (e) => {
  logger.error({ err: e }, "Prisma error");
});

if (process.env.NODE_ENV === "development") {
  prisma.$on("query", (e) => {
    logger.debug({ duration: e.duration, query: e.query }, "Prisma query");
  });
}

export async function disconnectDb() {
  await prisma.$disconnect();
}
