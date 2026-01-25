import express from 'express';
import { registerRoutes } from './routes.ts';
import { EthersAdapter } from './infrastructure/adapters/EthersAdapter';
import { DiscoveryService } from './application/services/DiscoveryService';
import { StorageService } from './application/services/StorageService';
import { ControllerService } from './application/services/ControllerService.ts';
import { DispatcherService } from './application/services/DispatcherService.ts';
import { CacheService } from './application/services/CacheService.ts';
import { RequestBatcher } from './application/services/RequestBatcher.ts';
import http from 'http';

const app = express();
const server = http.createServer(app);

// Replace body-parser with express.json()
app.use(express.json());

// Provide public RPC fallbacks for resilience
const { ALCHEMY_API_KEY, INFURA_API_KEY, POLYGON_RPC_URL } = process.env;

if (!INFURA_API_KEY) {
  console.warn(
    'INFURA_API_KEY not found, using public RPC. This may result in rate-limiting.'
  );
}
if (!ALCHEMY_API_KEY) {
  console.warn(
    'ALCHEMY_API_KEY not found, using public RPC. This may result in rate-limiting.'
  );
}
if (!POLYGON_RPC_URL) {
  console.warn(
    'POLYGON_RPC_URL not found, using public RPC. This may result in rate-limiting.'
  );
}

const ethProviders = [
  `https://mainnet.infura.io/v3/${INFURA_API_KEY || '84842078b09946638c03157f83405213'}`,
  `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY || 'demo'}`,
];

const polygonProviders = [
  POLYGON_RPC_URL || 'https://polygon-rpc.com',
];

const rpcProviders: { [chainId: number]: string } = {
  1: ethProviders[0],
  137: polygonProviders[0],
};

const ethersAdapter = new EthersAdapter(rpcProviders);
const storageService = new StorageService();
const cacheService = new CacheService();
const dispatcherService = new DispatcherService();

const controllerService = new ControllerService(
  ethersAdapter,
  storageService,
  cacheService,
  dispatcherService
);

const requestBatcher = new RequestBatcher(controllerService);

app.locals.storageService = storageService;
app.locals.requestBatcher = requestBatcher;

const discoveryService = new DiscoveryService(storageService, ethersAdapter);

// Run pool discovery in the background
(async () => {
  try {
    await discoveryService.discoverPools();
    console.log('Initial pool discovery complete.');
  } catch (error) {
    console.error('Error during initial pool discovery:', error);
  }
})();

// Register the routes
registerRoutes(server, app);

const port = 3002;
server.listen(port, () =>
  console.log(`Server is running on port ${port}`)
);
