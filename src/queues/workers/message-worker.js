import { Worker } from "bullmq";
import { redisConnection } from "../../config/redis.js";
import { routeMessage } from "../../services/message-router.js";
import { processMessage } from "../../services/ai-chatbot.js";
import { sendStoreButtons, handleStoreSelection } from "../../services/store-selector.js";
import { dispatchToAgent } from "../../services/dispatcher.js";
import { sendText } from "../../services/zapi.js";
import { saveMessage } from "../../services/session.js";
import { processMediaPipeline } from "../../services/media.js";
import { prisma } from "../../config/database.js";
import { logger } from "../../utils/logger.js";

// Socket.IO pode não estar disponível (worker separado)
let emitNewMessage;
try {
  const socketModule = await import("../../config/socket.js");
  emitNewMessage = socketModule.emitNewMessage;
} catch {
  emitNewMessage = () => {};
}

/**
 * Processa mídia recebida: download, salva no disco, atualiza MediaAttachment.
 */
async function processIncomingMedia(message, normalized) {
  if (!normalized.hasMedia || !normalized.mediaUrl) return;

  try {
    const result = await processMediaPipeline({
      mediaUrl: normalized.mediaUrl,
      mimeType: normalized.mimeType,
      fileName: normalized.fileName,
      mediaType: normalized.mediaType,
    });

    if (result && message.mediaAttachments?.length > 0) {
      await prisma.mediaAttachment.update({
        where: { id: message.mediaAttachments[0].id },
        data: {
          url: result.localUrl,
          fileName: result.fileName,
          fileSize: result.fileSize,
        },
      });
    }
  } catch (err) {
    logger.warn({ err, messageId: message.id }, "Media processing failed — continuing");
  }
}

/**
 * Processa rota BOT: chama a IA e, se necessário, aciona store-selector.
 */
async function handleBotRoute({ contact, conversation, normalized }) {
  const result = await processMessage({
    contact,
    conversation,
    messageBody: normalized.body,
  });

  // Envia resposta da IA ao cliente
  const zapiResult = await sendText(contact.phone, result.reply);

  // Salva mensagem da IA no banco como BOT
  await saveMessage({
    conversationId: conversation.id,
    direction: "OUTBOUND",
    senderType: "BOT",
    body: result.reply,
    externalId: zapiResult?.messageId || null,
  });

  // Se IA decidiu transferir → envia botões de seleção de loja
  if (result.action === "transfer") {
    await sendStoreButtons({ contact, conversation });
  }

  return { action: result.action, intent: result.intent };
}

/**
 * Processa BUTTON_RESPONSE com store_xxx: carteiriza e despacha.
 */
async function handleStoreSelect({ contact, conversation, normalized }) {
  const selection = await handleStoreSelection({
    contact,
    conversation,
    buttonId: normalized.buttonId,
  });

  if (!selection) {
    await sendStoreButtons({ contact, conversation });
    return { action: "retry_store_select" };
  }

  const dispatch = await dispatchToAgent({
    contact: selection.contact,
    conversation,
    store: selection.store,
  });

  return { action: dispatch.assigned ? "dispatched" : "queued", store: selection.store.name };
}

/**
 * Processa rota AGENT: notifica via Socket.IO (painel fase 3).
 */
async function handleAgentRoute({ contact, conversation, message, normalized }) {
  logger.info(
    {
      phone: contact.phone,
      agentId: contact.assignedAgentId || conversation.agentId,
      conversationId: conversation.id,
    },
    "Message routed to AGENT"
  );

  // Notifica atendente via Socket.IO em tempo real
  emitNewMessage({ conversation, message, contact });

  return { action: "agent_notified" };
}

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

      // Processa mídia em paralelo (não bloqueia o fluxo principal)
      processIncomingMedia(result.message, result.normalized).catch(() => {});

      // Executa handler com base na rota
      let handlerResult;

      switch (result.route) {
        case "BOT":
          handlerResult = await handleBotRoute(result);
          break;

        case "STORE_SELECT":
          handlerResult = await handleStoreSelect(result);
          break;

        case "AGENT":
          handlerResult = await handleAgentRoute(result);
          break;

        case "QUEUE":
          logger.info({ phone, conversationId: result.conversation.id }, "Message in QUEUE — waiting for agent");
          emitNewMessage({ conversation: result.conversation, message: result.message, contact: result.contact });
          handlerResult = { action: "queued" };
          break;

        default:
          logger.warn({ route: result.route }, "Unknown route");
          handlerResult = { action: "unknown" };
      }

      return { ...result, handlerResult };
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
