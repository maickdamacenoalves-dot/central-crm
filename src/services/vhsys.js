import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

const BASE_URL = env.VHSYS_BASE_URL;

const headers = {
  "Content-Type": "application/json",
  "access-token": env.VHSYS_TOKEN,
  "secret-access-token": env.VHSYS_SECRET,
};

async function vhsysRequest(method, endpoint, body = null) {
  const url = `${BASE_URL}${endpoint}`;
  try {
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(url, options);

    if (!res.ok) {
      const text = await res.text();
      logger.error({ endpoint, status: res.status, text }, "VHSYS request failed");
      throw new Error(`VHSYS ${res.status}: ${text}`);
    }

    return res.json();
  } catch (err) {
    logger.error({ err, endpoint }, "VHSYS request error");
    throw err;
  }
}

// ── Produtos ─────────────────────────────────────────────

export async function getProducts(page = 1, limit = 50) {
  return vhsysRequest("GET", `/produtos?limit=${limit}&page=${page}`);
}

export async function getProductStock(productId) {
  return vhsysRequest("GET", `/produtos/${productId}/estoque`);
}

export async function searchProducts(query) {
  return vhsysRequest("GET", `/produtos?lpiDescricaoProduto=${encodeURIComponent(query)}`);
}

// ── Clientes ─────────────────────────────────────────────

export async function getClient(phone) {
  return vhsysRequest("GET", `/clientes?lpiTelefone=${encodeURIComponent(phone)}`);
}

export async function createClient(data) {
  return vhsysRequest("POST", "/clientes", data);
}

/**
 * Sync bidirecional CRM ↔ VHSYS.
 * Busca cliente no VHSYS pelo telefone do contato. Se não existe, cria.
 * Retorna o ID do cliente no VHSYS.
 */
export async function syncClient(contact) {
  try {
    // Tenta encontrar no VHSYS
    const result = await getClient(contact.phone);
    const clients = result?.data || [];

    if (clients.length > 0) {
      logger.info({ contactId: contact.id, vhsysClientId: clients[0].id_cliente }, "VHSYS client found");
      return clients[0];
    }

    // Cria novo cliente no VHSYS
    const newClient = await createClient({
      razao_social: contact.name || `WhatsApp ${contact.phone}`,
      telefone: contact.phone,
      tipo_cliente: "F", // Pessoa física
    });

    logger.info({ contactId: contact.id, vhsysClientId: newClient?.data?.id_cliente }, "VHSYS client created");
    return newClient?.data || newClient;
  } catch (err) {
    logger.error({ err, contactId: contact.id }, "VHSYS sync error");
    throw err;
  }
}

// ── Orçamentos e Pedidos ─────────────────────────────────

export async function createQuote(items, clientId) {
  return vhsysRequest("POST", "/orcamentos", {
    id_cliente: clientId,
    produtos: items.map((item) => ({
      id_produto: item.productId,
      quantidade: item.quantity,
      valor_unitario: item.unitPrice,
    })),
  });
}

export async function convertQuoteToOrder(quoteId) {
  return vhsysRequest("POST", `/orcamentos/${quoteId}/converter`);
}

export async function getOrderStatus(orderId) {
  return vhsysRequest("GET", `/pedidos/${orderId}`);
}
