import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  API_PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.string().default("info"),

  // Postgres
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().default(""),

  // JWT
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),

  // Encryption
  ENCRYPTION_KEY: z.string().min(32),

  // Z-API
  ZAPI_INSTANCE_ID: z.string(),
  ZAPI_INSTANCE_TOKEN: z.string(),
  ZAPI_BASE_URL: z.string().url(),
  ZAPI_CLIENT_TOKEN: z.string(),

  // Anthropic
  ANTHROPIC_API_KEY: z.string(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-20250514"),

  // VHSYS
  VHSYS_TOKEN: z.string(),
  VHSYS_SECRET: z.string(),
  VHSYS_BASE_URL: z.string().url(),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("Invalid environment variables:");
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
