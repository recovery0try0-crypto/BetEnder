import { EthersAdapter, PoolData } from '../../infrastructure/adapters/EthersAdapter';
import { StorageService } from './StorageService';
import { TokenMetadata } from '../../../shared/tokens';
import { QuoteRequest } from './RequestBatcher';
import { CacheService } from './CacheService';
import { DispatcherService } from './DispatcherService';
import { calculateBestPrice, Quote } from '../../domain/pricing';

const REFRESH_INTERVAL = 10000; // 10 seconds

export class ControllerService {
  private lastUpdated: Map<string, number> = new Map();
  private tokenMetadata: Map<string, TokenMetadata> = new Map();
  private ethereumPools: Record<string, string> = {};
  private polygonPools: Record<string, string> = {};

  constructor(
    private readonly ethersAdapter: EthersAdapter,
    private readonly storageService: StorageService,
    private readonly cacheService: CacheService,
    private readonly dispatcherService: DispatcherService
  ) {
    this.loadInitialData();
  }

  private async loadInitialData(): Promise<void> {
    console.log("Controller: Loading initial token and pool data...");
    const tokens = await this.storageService.read('tokens.json') as TokenMetadata[];
    this.tokenMetadata = new Map(tokens.map(t => [t.address, t]));

    this.ethereumPools = await this.storageService.read('pools_ethereum.json');
    this.polygonPools = await this.storageService.read('pools_polygon.json');
    console.log("Controller: Initial data loaded.");
  }

  public async getQuotes(requests: QuoteRequest[]): Promise<void> {
    // Register all resolvers
    requests.forEach(req => this.dispatcherService.register(req.id, req.resolve));

    // Deduplicate by request ID
    const uniqueRequests = Array.from(new Map(requests.map(req => [req.id, req])).values());

    for (const request of uniqueRequests) {
      const cacheKey = this.cacheService.generateKey(request.tokenIn.address, request.tokenOut.address, request.amount);
      const cachedQuote = this.cacheService.getQuote(cacheKey);

      if (cachedQuote) {
        this.dispatcherService.dispatch(request.id, cachedQuote);
        continue;
      }

      const tokensToUpdate = new Set<string>([request.tokenIn.address, request.tokenOut.address]);
      const now = Date.now();

      const needsUpdate = Array.from(tokensToUpdate).some(address => {
        const lastUpdate = this.lastUpdated.get(address);
        return !lastUpdate || (now - lastUpdate) > REFRESH_INTERVAL;
      });

      if (needsUpdate) {
        const tokensByChain = this.groupTokensByChain(tokensToUpdate);

        for (const [chainId, addresses] of Object.entries(tokensByChain)) {
          const chainIdNum = parseInt(chainId, 10);
          const poolsToQuery = this.getAssociatedPools(addresses, chainIdNum);
          
          if (poolsToQuery.size > 0) {
            const poolData = await this.ethersAdapter.getBatchPoolData(Array.from(poolsToQuery), chainIdNum);
            const quote = calculateBestPrice(request.tokenIn.address, request.tokenOut.address, request.amount, poolData);
            
            if (quote) {
              this.cacheService.setQuote(cacheKey, quote);
              this.dispatcherService.dispatch(request.id, quote);
              
              const now = Date.now();
              addresses.forEach(address => this.lastUpdated.set(address, now));
            } else {
              // Handle case where no price could be calculated
              this.dispatcherService.dispatch(request.id, { error: 'Could not calculate price' } as any);
            }
          }
        }
      } else {
        // This part is tricky - if prices are considered fresh, we still need to calculate a quote
        // but without fetching new data. This requires having the pool data in memory.
        // For now, we will just re-fetch, but a future optimization would be to have an in-memory representation.
        console.log("Controller: Prices are fresh, but re-fetching for quote calculation.");
        const tokensByChain = this.groupTokensByChain(tokensToUpdate);
        for (const [chainId, addresses] of Object.entries(tokensByChain)) {
          const chainIdNum = parseInt(chainId, 10);
          const poolsToQuery = this.getAssociatedPools(addresses, chainIdNum);
          if (poolsToQuery.size > 0) {
            const poolData = await this.ethersAdapter.getBatchPoolData(Array.from(poolsToQuery), chainIdNum);
            const quote = calculateBestPrice(request.tokenIn.address, request.tokenOut.address, request.amount, poolData);
            if (quote) {
              this.cacheService.setQuote(cacheKey, quote);
              this.dispatcherService.dispatch(request.id, quote);
            }
          }
        }
      }
    }
  }

  private groupTokensByChain(tokenAddresses: Set<string>): Record<number, string[]> {
    const grouped: Record<number, string[]> = {};
    for (const address of tokenAddresses) {
      const metadata = this.tokenMetadata.get(address);
      if (metadata) {
        if (!grouped[metadata.chainId]) {
          grouped[metadata.chainId] = [];
        }
        grouped[metadata.chainId].push(address);
      }
    }
    return grouped;
  }

  private getAssociatedPools(tokenAddresses: string[], chainId: number): Set<string> {
    const relevantPools = chainId === 1 ? this.ethereumPools : this.polygonPools;
    const poolsToQuery = new Set<string>();

    const addressSet = new Set(tokenAddresses);

    for (const [poolKey, poolAddress] of Object.entries(relevantPools)) {
      const [tokenA, tokenB] = poolKey.split('_');
      if (addressSet.has(tokenA) || addressSet.has(tokenB)) {
        poolsToQuery.add(poolAddress);
      }
    }

    return poolsToQuery;
  }
}
