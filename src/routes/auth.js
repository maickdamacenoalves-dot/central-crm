import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { env } from "../config/env.js";
import { authenticate } from "../middleware/auth.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export async function authRoutes(app) {
  // POST /auth/login
  app.post("/login", async (request, reply) => {
    const { email, password } = loginSchema.parse(request.body);

    const agent = await prisma.agent.findUnique({
      where: { email },
      include: { store: true },
    });

    if (!agent || !agent.isActive) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, agent.passwordHash);
    if (!valid) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const tokenPayload = {
      id: agent.id,
      email: agent.email,
      role: agent.role,
      storeId: agent.storeId,
    };

    const accessToken = app.jwt.sign(tokenPayload);
    const refreshToken = app.jwt.sign(tokenPayload, {
      expiresIn: env.JWT_REFRESH_EXPIRES_IN,
    });

    // Store refresh token in Redis
    await redis.set(
      `refresh:${agent.id}`,
      refreshToken,
      "EX",
      7 * 24 * 60 * 60
    );

    // Update last login
    await prisma.agent.update({
      where: { id: agent.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      accessToken,
      refreshToken,
      agent: {
        id: agent.id,
        name: agent.name,
        email: agent.email,
        role: agent.role,
        store: agent.store.name,
      },
    };
  });

  // POST /auth/refresh
  app.post("/refresh", async (request, reply) => {
    const { refreshToken } = request.body;
    if (!refreshToken) {
      return reply.code(400).send({ error: "Refresh token required" });
    }

    try {
      const decoded = app.jwt.verify(refreshToken);
      const stored = await redis.get(`refresh:${decoded.id}`);

      if (stored !== refreshToken) {
        return reply.code(401).send({ error: "Invalid refresh token" });
      }

      const tokenPayload = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
        storeId: decoded.storeId,
      };

      const newAccessToken = app.jwt.sign(tokenPayload);
      const newRefreshToken = app.jwt.sign(tokenPayload, {
        expiresIn: env.JWT_REFRESH_EXPIRES_IN,
      });

      await redis.set(
        `refresh:${decoded.id}`,
        newRefreshToken,
        "EX",
        7 * 24 * 60 * 60
      );

      return { accessToken: newAccessToken, refreshToken: newRefreshToken };
    } catch {
      return reply.code(401).send({ error: "Invalid refresh token" });
    }
  });

  // POST /auth/logout
  app.post("/logout", { preHandler: [authenticate] }, async (request) => {
    await redis.del(`refresh:${request.user.id}`);
    return { message: "Logged out" };
  });

  // GET /auth/me
  app.get("/me", { preHandler: [authenticate] }, async (request) => {
    const agent = await prisma.agent.findUnique({
      where: { id: request.user.id },
      include: { store: true },
    });

    if (!agent) {
      return { error: "Agent not found" };
    }

    return {
      id: agent.id,
      name: agent.name,
      email: agent.email,
      role: agent.role,
      store: agent.store.name,
      storeId: agent.storeId,
    };
  });
}
