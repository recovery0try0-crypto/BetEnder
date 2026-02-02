// Load .env file FIRST before any imports that use process.env
import dotenv from 'dotenv';
import path from 'path';

// Use process.cwd() which is reliable in all contexts
const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

import express from 'express';
import { registerRoutes } from './routes.ts';
import { EthersAdapter } from './infrastructure/adapters/EthersAdapter';
import { DiscoveryService } from './application/services/DiscoveryService';
import { StorageService } from './application/services/StorageService';
import { QuarantineValidator } from './application/services/QuarantineValidator';
import { TokenDiscoveryManager } from './application/services/TokenDiscoveryManager';
import { GCManager } from './application/services/GCManager';
import http from 'http';
import { priceViewerService } from './application/services/PriceViewerService.ts';
import { sharedStateCache } from './application/services/SharedStateCache.ts';
import { SwapController } from './application/services/SwapController.ts';
import { providersConfig } from './infrastructure/config/ProvidersConfig';
import { getRpcConfig } from './infrastructure/config/RpcConfig';
import { explorerConfig } from './infrastructure/config/ExplorerConfig';

// Reinitialize config modules with loaded env vars
const rpcConfig = getRpcConfig();
explorerConfig.reinitialize();
providersConfig.reinitialize();

const app = express();
const server = http.createServer(app);

// Replace body-parser with express.json()
app.use(express.json());
app.use(express.static('dist/public'));

// Build RPC provider map from ProvidersConfig; in development we allow a public RPC fallback
const rpcProviders: { [chainId: number]: string } = {};

try {
  rpcProviders[1] = providersConfig.getRpcProvider(1);
} catch (err) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn('No configured RPC for Ethereum. Falling back to a public RPC endpoint for development. Set INFURA_API_KEY or ALCHEMY_API_KEY to avoid this in production.');
    rpcProviders[1] = process.env.ETHEREUM_PUBLIC_RPC || 'https://cloudflare-eth.com';
  } else {
    console.error('No configured RPC for Ethereum. Please set INFURA_API_KEY or ALCHEMY_API_KEY. Exiting.');
    process.exit(1);
  }
}

try {
  rpcProviders[137] = providersConfig.getRpcProvider(137);
} catch (err) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn('No configured RPC for Polygon. Falling back to a public RPC endpoint for development. Set POLYGON_RPC_URL to avoid this in production.');
    rpcProviders[137] = process.env.POLYGON_PUBLIC_RPC || 'https://polygon-rpc.com';
  } else {
    console.error('No configured RPC for Polygon. Please set POLYGON_RPC_URL. Exiting.');
    process.exit(1);
  }
}

const ethersAdapter = new EthersAdapter(rpcProviders);
const storageService = new StorageService();

app.locals.storageService = storageService;
app.locals.ethersAdapter = ethersAdapter;
app.locals.explorerConfig = explorerConfig;

const discoveryService = new DiscoveryService(storageService, ethersAdapter);

// Run pool discovery in the background (unless disabled via env var)
if (process.env.SKIP_DISCOVERY !== 'true') {
  (async () => {
    try {
      await discoveryService.discoverAndPrimeCache();
      console.log('Initial pool discovery complete.');
    } catch (error) {
      console.error('Error during initial pool discovery:', error);
      console.warn('Continuing server startup despite discovery failure. Pool registry may be incomplete.');
    }
  })();
} else {
  console.log('⏭️  Pool discovery skipped (SKIP_DISCOVERY=true)');
}

const swapController = new SwapController();

// Initialize TokenDiscoveryManager for use by other services
const tokenDiscoveryManager = new TokenDiscoveryManager(storageService);

// PHASE 7: Initialize and start quarantine validator
const quarantineValidator = new QuarantineValidator(storageService, ethersAdapter, tokenDiscoveryManager);
console.log('🔄 PHASE 7: Starting quarantine validator loops...');
quarantineValidator.startValidationLoop(1); // Ethereum
quarantineValidator.startValidationLoop(137); // Polygon

// PHASE 8: Initialize and start garbage collection manager
const gcManager = new GCManager(storageService);
gcManager.startAllCleanupLoops();

// Graceful shutdown: stop validators and GC
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  quarantineValidator.stopAllLoops();
  gcManager.stopAllCleanupLoops();
  server.close();
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  quarantineValidator.stopAllLoops();
  gcManager.stopAllCleanupLoops();
  server.close();
});

// Register the routes
registerRoutes(app, priceViewerService, swapController);

const port = 3002;
server.listen(port, () =>
  console.log(`Server is running on port ${port}`)
);
