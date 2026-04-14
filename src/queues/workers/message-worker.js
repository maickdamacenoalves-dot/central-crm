import { Worker } from "bullmq";
import { redisConnection } from "../../config/redis.js";
import { routeMessage } from "../../services/message-router.js";
import { processMessage } from "../../services/ai-chatbot.js";
import { sendStoreButtons, handleStoreSelection } from "../../services/store-selector.js";
import { dispatchToAgent } from "../../services/dispatcher.js";
import { sendText } from "../../services/zapi.js";
import { saveMessage } from "../../services/session.js";
import { logger } from "../../utils/logger.js";

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
    // Botão inválido — reenvia seleção
    await sendStoreButtons({ contact, conversation });
    return { action: "retry_store_select" };
  }

  // Despacha para atendente da loja selecionada
  const dispatch = await dispatchToAgent({
    contact: selection.contact,
    conversation,
    store: selection.store,
  });

  return { action: dispatch.assigned ? "dispatched" : "queued", store: selection.store.name };
}

/**
 * Processa rota AGENT: por enquanto só loga (painel vem na fase 3).
 */
async function handleAgentRoute({ contact, conversation, normalized }) {
  logger.info(
    {
      phone: contact.phone,
      agentId: contact.assignedAgentId || conversation.agentId,
      conversationId: conversation.id,
    },
    "Message routed to AGENT — awaiting panel (fase 3)"
  );

  return { action: "agent_pending" };
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
