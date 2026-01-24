import type { Express } from "express";
import { type Server } from "http";
import { api } from "../../shared/routes";

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {

  app.get(api.tokens.getAll.path, async (_req, res) => {
    try {
      const tokens = await app.locals.storageService.read('tokens.json');
      res.json({ tokens });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post(api.quote.get.path, async (req, res) => {
    try {
      const { tokenIn, tokenOut, amount } = req.body;

      if (!tokenIn || !tokenOut || !amount) {
        return res.status(400).json({ message: "Missing required parameters" });
      }

      const quote = await app.locals.requestBatcher.addQuoteRequest(tokenIn, tokenOut, amount);
      res.json(quote);

    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return httpServer;
}
