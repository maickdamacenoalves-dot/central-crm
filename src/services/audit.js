import { prisma } from "../config/database.js";
import { logger } from "../utils/logger.js";

/**
 * Registra um evento de auditoria.
 *
 * @param {object} params
 * @param {string} [params.orgId]         - ID da organização
 * @param {string} [params.actorId]       - ID do agente/ator
 * @param {string} [params.actorType]     - "agent" | "system" | "api"
 * @param {string}  params.action         - e.g. "login", "transfer_conversation"
 * @param {string}  params.resourceType   - e.g. "agent", "conversation", "contact"
 * @param {string} [params.resourceId]    - ID do recurso afetado
 * @param {object} [params.details]       - Dados extras (JSON)
 * @param {string} [params.ipAddress]     - IP do request
 */
export async function logAudit({
  orgId = null,
  actorId = null,
  actorType = "agent",
  action,
  resourceType,
  resourceId = null,
  details = null,
  ipAddress = null,
}) {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: orgId,
        agentId: actorId,
        actorType,
        action,
        entity: resourceType,
        entityId: resourceId,
        details,
        ip: ipAddress,
      },
    });

    logger.debug({ action, resourceType, resourceId, actorId }, "Audit log recorded");
  } catch (err) {
    logger.error({ err, action, resourceType }, "Failed to write audit log");
  }
}

/**
 * Helper para extrair IP do request Fastify.
 */
export function getClientIp(request) {
  return (
    request.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    request.headers["x-real-ip"] ||
    request.ip
  );
}
