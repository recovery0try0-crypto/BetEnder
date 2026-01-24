import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { StorageService } from "./application/services/StorageService";
import { EthersAdapter } from "./infrastructure/adapters/EthersAdapter";
import { DiscoveryService } from "./application/services/DiscoveryService";
import { ControllerService } from "./application/services/ControllerService";
import { RequestBatcher } from "./application/services/RequestBatcher";
import { CacheService } from "./application/services/CacheService";
import { DispatcherService } from "./application/services/DispatcherService";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // === Clean Architecture Setup ===
  const storageService = new StorageService();
  const cacheService = new CacheService();
  const dispatcherService = new DispatcherService();

  const ethRpcUrl = process.env.ALCHEMY_API_KEY
    ? `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
    : process.env.INFURA_API_KEY
    ? `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`
    : null;

  const polygonRpcUrl = process.env.POLYGON_RPC_URL;

  if (!ethRpcUrl || !polygonRpcUrl) {
    log("Missing Alchemy/Infura API key or Polygon RPC URL. Please set ALCHEMY_API_KEY/INFURA_API_KEY and POLYGON_RPC_URL environment variables.");
    process.exit(1);
  }

  const rpcUrls = {
    1: ethRpcUrl,
    137: polygonRpcUrl
  };

  const ethersAdapter = new EthersAdapter(rpcUrls);

  // Cold Path: One-time discovery on startup
  const discoveryService = new DiscoveryService(storageService, ethersAdapter);
  await discoveryService.discoverPools();

  // Hot Path: Real-time quoting services
  const controllerService = new ControllerService(ethersAdapter, storageService, cacheService, dispatcherService);
  const requestBatcher = new RequestBatcher(controllerService);

  app.locals.requestBatcher = requestBatcher;
  app.locals.storageService = storageService;

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
