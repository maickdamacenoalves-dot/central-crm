import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../config/database.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Você é a assistente virtual da Central de Tintas, um grupo com 5 lojas no sul de Santa Catarina:
- Central de Tintas Garopaba
- Central de Tintas Imbituba
- Central de Tintas Laguna
- SW Garopaba
- Garopaba Tintas

Você é especialista em tintas e materiais de pintura. Seu conhecimento inclui:

TIPOS DE TINTA:
- Látex PVA: para paredes internas, acabamento fosco, econômica
- Acrílica Standard: para paredes internas e externas, lavável, boa durabilidade
- Acrílica Premium: alto rendimento, cobertura superior, lavável, resistente ao mofo
- Esmalte sintético: para madeiras e metais, acabamento brilhante ou acetinado
- Esmalte a base d'água: menos odor, secagem rápida, para madeiras e metais
- Tinta epóxi: pisos industriais, garagens, alta resistência
- Verniz e stain: proteção para madeiras, decks, pergolados
- Massa corrida PVA (interno) e Massa acrílica (externo): para nivelar paredes
- Selador: para preparação antes da pintura
- Textura: acabamento decorativo para paredes externas

RENDIMENTO MÉDIO (por demão, em m² por litro):
- Látex PVA: 8-10 m²/L
- Acrílica: 8-12 m²/L
- Esmalte: 10-12 m²/L
- Selador: 15-20 m²/L
- Massa corrida: 4-6 m²/L por mm de espessura

DILUIÇÃO:
- Látex/Acrílica 1ª demão: até 20-30% de água
- Látex/Acrílica 2ª demão: até 10-15% de água
- Esmalte sintético: 5-10% de aguarrás ou thinner
- Esmalte base d'água: até 10% de água

CÁLCULO DE QUANTIDADE:
- Fórmula: (Área em m² × número de demãos) ÷ rendimento = litros necessários
- Geralmente 2-3 demãos para boa cobertura
- Cores escuras sobre claras: 3+ demãos
- Paredes novas: adicionar selador + 1 demão extra
- Sempre oriente comprar 10% a mais como margem de segurança

INDICAÇÕES POR SUPERFÍCIE:
- Parede interna: acrílica standard ou premium
- Parede externa: acrílica premium (resistente a intempéries e mofo)
- Banheiro/cozinha: acrílica premium semi-brilho (lavável, anti-mofo)
- Madeira: esmalte ou verniz/stain
- Metal/portão: esmalte sintético ou tinta para metal com antiferrugem
- Piso de garagem: tinta epóxi ou piso
- Teto: látex PVA (econômica, baixo desgaste)

INSTRUÇÕES DE COMPORTAMENTO:
- Seja simpática, profissional e objetiva
- Use linguagem acessível, evite termos muito técnicos sem explicar
- Sempre pergunte a metragem quando o cliente quer calcular quantidade
- Pergunte sobre a superfície e ambiente para recomendar o produto certo
- Sugira produtos complementares quando relevante (selador, lixa, rolo, fita crepe)
- Quando não souber algo específico sobre estoque ou preço, informe que vai transferir para um atendente
- NÃO invente preços ou disponibilidade de estoque
- Responda APENAS sobre tintas, pintura e materiais relacionados. Para outros assuntos, diga educadamente que é especialista em tintas
- Mantenha respostas concisas para WhatsApp (mensagens curtas, use quebras de linha)`;

const TRANSFER_REASONS = [
  "cliente pediu para falar com atendente",
  "cliente pediu atendente humano",
  "reclamação",
  "negociação de preço",
  "desconto",
  "orçamento complexo",
  "problema com pedido",
  "estoque específico",
  "preço",
];

/**
 * Busca ou cria o AiContext para um contato/conversa.
 */
async function getOrCreateAiContext(contactId, conversationId) {
  let ctx = await prisma.aiContext.findUnique({
    where: { contactId_conversationId: { contactId, conversationId } },
  });

  if (!ctx) {
    ctx = await prisma.aiContext.create({
      data: {
        contactId,
        conversationId,
        messages: [],
        transferCount: 0,
      },
    });
  }

  return ctx;
}

/**
 * Detecta a intenção da mensagem do cliente.
 */
function detectIntent(text) {
  if (!text) return "geral";
  const lower = text.toLowerCase();

  if (/or[çc]amento|quanto custa|pre[çc]o|valor/.test(lower)) return "orcamento";
  if (/reclama|problema|defeito|errad|insatisf/.test(lower)) return "reclamacao";
  if (/pedido|entrega|status|rastreio|comprei/.test(lower)) return "status_pedido";
  if (/rend|dilu|quant|litro|m[²2]|metro|demão|cobertura|tipo|qual tinta|indicar|superficie/.test(lower)) return "duvida_tecnica";
  return "geral";
}

/**
 * Verifica se a mensagem deve acionar transferência para humano.
 */
function shouldTransfer(text, aiContext) {
  if (!text) return false;
  const lower = text.toLowerCase();

  // Cliente pediu atendente
  if (/atendente|humano|pessoa|falar com algu[eé]m|gerente|vendedor/.test(lower)) return true;

  // Reclamação
  if (/reclama|insatisf|absurd|vergonha|processo|procon/.test(lower)) return true;

  // Negociação de preço
  if (/desconto|negociar|baixar.*pre[çc]o|melhor.*pre[çc]o|condi[çc][ãa]o/.test(lower)) return true;

  // 3+ tentativas sem resolver (transferCount acumulado)
  if (aiContext.transferCount >= 2) return true;

  return false;
}

/**
 * Processa uma mensagem do cliente via IA.
 * Retorna { reply, action, intent }
 *   action: "continue" | "transfer"
 */
export async function processMessage({ contact, conversation, messageBody }) {
  const aiContext = await getOrCreateAiContext(contact.id, conversation.id);
  const intent = detectIntent(messageBody);

  // Histórico do AiContext
  const history = Array.isArray(aiContext.messages) ? aiContext.messages : [];

  // Verifica transferência antes de chamar a IA
  if (shouldTransfer(messageBody, aiContext)) {
    // Incrementa transferCount
    await prisma.aiContext.update({
      where: { id: aiContext.id },
      data: {
        intent,
        transferCount: { increment: 1 },
        messages: [...history, { role: "user", content: messageBody }],
      },
    });

    logger.info(
      { contactId: contact.id, intent },
      "Transfer triggered — handing to store selector"
    );

    return {
      reply: "Entendi! Vou te transferir para um de nossos atendentes. Primeiro, me diz de qual loja você gostaria de ser atendido? 😊",
      action: "transfer",
      intent,
    };
  }

  // Monta mensagens para a API
  const messages = [
    ...history.slice(-20), // últimas 20 mensagens para contexto
    { role: "user", content: messageBody || "Olá" },
  ];

  try {
    const response = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages,
    });

    const reply = response.content[0]?.text || "Desculpe, não consegui processar sua mensagem. Pode repetir?";

    // Atualiza contexto no banco
    const updatedMessages = [
      ...history,
      { role: "user", content: messageBody },
      { role: "assistant", content: reply },
    ].slice(-40); // mantém últimas 40 entradas

    await prisma.aiContext.update({
      where: { id: aiContext.id },
      data: {
        intent,
        sentiment: detectSentiment(messageBody),
        messages: updatedMessages,
      },
    });

    // Verifica se a IA sugeriu transferência na resposta
    const aiSuggestsTransfer = /transfer|atendente|vou te conectar|encaminhar para/.test(reply.toLowerCase());
    if (aiSuggestsTransfer) {
      await prisma.aiContext.update({
        where: { id: aiContext.id },
        data: { transferCount: { increment: 1 } },
      });
    }

    return {
      reply,
      action: aiSuggestsTransfer ? "transfer" : "continue",
      intent,
    };
  } catch (err) {
    logger.error({ err, contactId: contact.id }, "AI chat error");

    return {
      reply: "Ops, tive um probleminha técnico. Vou te transferir para um atendente que pode te ajudar!",
      action: "transfer",
      intent,
    };
  }
}

/**
 * Detecta sentimento básico da mensagem.
 */
function detectSentiment(text) {
  if (!text) return "neutral";
  const lower = text.toLowerCase();

  if (/obrigad|valeu|perfeito|excelente|ótimo|maravilh|adorei|show/.test(lower)) return "positive";
  if (/reclam|insatisf|péssim|horrível|absurd|lixo|porcaria|raiva/.test(lower)) return "negative";
  return "neutral";
}
