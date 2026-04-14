import { authenticate } from "../../middleware/auth.js";
import * as vhsys from "../../services/vhsys.js";

export async function vhsysRoutes(app) {
  app.addHook("onRequest", authenticate);

  // GET /api/vhsys/products?search= — busca produtos
  app.get("/products", async (request) => {
    const { search, page = 1 } = request.query;

    if (search) {
      return vhsys.searchProducts(search);
    }

    return vhsys.getProducts(Number(page));
  });

  // GET /api/vhsys/products/:id/stock — estoque de um produto
  app.get("/products/:id/stock", async (request) => {
    return vhsys.getProductStock(request.params.id);
  });

  // POST /api/vhsys/quotes — criar orçamento
  app.post("/quotes", async (request, reply) => {
    const { items, clientId } = request.body || {};

    if (!items?.length || !clientId) {
      return reply.code(400).send({ error: "items (array) and clientId are required" });
    }

    return vhsys.createQuote(items, clientId);
  });

  // POST /api/vhsys/quotes/:id/convert — converter orçamento em pedido
  app.post("/quotes/:id/convert", async (request) => {
    return vhsys.convertQuoteToOrder(request.params.id);
  });

  // GET /api/vhsys/orders/:id — status do pedido
  app.get("/orders/:id", async (request) => {
    return vhsys.getOrderStatus(request.params.id);
  });
}
