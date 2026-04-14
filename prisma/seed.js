import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // ── Organization ───────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { document: "00000000000100" },
    update: {},
    create: {
      name: "Grupo Central de Tintas",
      document: "00000000000100",
    },
  });

  // ── Stores ─────────────────────────────────────────
  const storeNames = [
    "Central de Tintas Garopaba",
    "Central de Tintas Imbituba",
    "Central de Tintas Laguna",
    "SW Garopaba",
    "Garopaba Tintas",
  ];

  const stores = [];
  for (const name of storeNames) {
    const store = await prisma.store.upsert({
      where: { id: name.toLowerCase().replace(/\s+/g, "-") },
      update: {},
      create: {
        id: name.toLowerCase().replace(/\s+/g, "-"),
        organizationId: org.id,
        name,
      },
    });
    stores.push(store);
  }

  // ── Admin ──────────────────────────────────────────
  const adminHash = await bcrypt.hash("Admin@2025!", 12);

  await prisma.agent.upsert({
    where: { email: "maick@centraldetintas.com" },
    update: {},
    create: {
      storeId: stores[0].id,
      name: "Maick Damaceno",
      email: "maick@centraldetintas.com",
      passwordHash: adminHash,
      role: "SUPER_ADMIN",
    },
  });

  // ── Atendentes ─────────────────────────────────────
  const agentHash = await bcrypt.hash("Atendente@2025!", 12);

  const agents = [
    { name: "Atendente 1", email: "atendente1@centraldetintas.com", storeIdx: 0 },
    { name: "Atendente 2", email: "atendente2@centraldetintas.com", storeIdx: 0 },
    { name: "Atendente 3", email: "atendente3@centraldetintas.com", storeIdx: 1 },
    { name: "Atendente 4", email: "atendente4@centraldetintas.com", storeIdx: 1 },
    { name: "Atendente 5", email: "atendente5@centraldetintas.com", storeIdx: 2 },
    { name: "Atendente 6", email: "atendente6@centraldetintas.com", storeIdx: 2 },
    { name: "Atendente 7", email: "atendente7@centraldetintas.com", storeIdx: 3 },
    { name: "Atendente 8", email: "atendente8@centraldetintas.com", storeIdx: 4 },
  ];

  for (const a of agents) {
    await prisma.agent.upsert({
      where: { email: a.email },
      update: {},
      create: {
        storeId: stores[a.storeIdx].id,
        name: a.name,
        email: a.email,
        passwordHash: agentHash,
        role: "AGENT",
      },
    });
  }

  console.log("Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
