
import { EthersAdapter } from '../../infrastructure/adapters/EthersAdapter';
import { StorageService } from './StorageService';
import { Token } from '../../domain/entities';
import { sharedStateCache } from './SharedStateCache';
import { PoolState, TokenMetadata, PoolRegistry, PoolMetadata, PricingRoute } from '../../domain/types';
import { explorerConfig } from '../../infrastructure/config/ExplorerConfig';

export class DiscoveryService {
  constructor(
    private readonly storageService: StorageService,
    private readonly ethersAdapter: EthersAdapter,
  ) {}

  // Add delay between RPC calls to avoid rate limiting
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async discoverAndPrimeCache(): Promise<void> {
    console.log('Starting pool and token discovery to prime the cache...');
    console.log('🔍 Using Explorer APIs (Cold Path) where available');
    
    // Get all tokens from all networks (both Ethereum and Polygon)
    const ethTokens: Token[] = await this.storageService.getTokensByNetwork(1);
    const polygonTokens: Token[] = await this.storageService.getTokensByNetwork(137);
    const tokens = [...ethTokens, ...polygonTokens];

    // 1. Prime Token Metadata (with delays to avoid rate limiting)
    for (const token of tokens) {
      try {
        // Attempt to get metadata via explorer first (Cold Path)
        let metadata: TokenMetadata | null = null;
        try {
          const explorer = explorerConfig.getExplorer(token.chainId);
          if (explorer.apiKey) {
            const url = `${explorer.baseUrl}?module=token&action=tokeninfo&contractaddress=${token.address}&apikey=${explorer.apiKey}`;
            const response = await fetch(url);
            const data = await response.json() as any;
            if (data.status === "1" && data.result && data.result[0]) {
              const info = data.result[0];
              metadata = {
                name: info.tokenName || info.name || token.name,
                symbol: info.symbol || token.symbol,
                decimals: parseInt(info.divisor || info.decimals || token.decimals.toString())
              };
              console.log(`✓ Fetched metadata for ${token.symbol} via Explorer API`);
            }
          }
        } catch (e) {
          console.warn(`Explorer metadata fetch failed for ${token.symbol}, falling back to RPC`);
        }

        if (!metadata) {
          metadata = await this.ethersAdapter.getTokenMetadata(token.address, token.chainId);
        }
        
        sharedStateCache.setTokenMetadata(token.address, metadata);
      } catch (error: any) {
        console.error(`Error fetching metadata for ${token.symbol}:`, error.message);
      }
      // Add delay between metadata fetches to avoid rate limiting
      await this.delay(500);
    }
    console.log('Token metadata cache priming complete.');

    // 2. Discover Pools and Prime their State (and build Pool Registry)
    const tokensByChain = tokens.reduce((acc, token) => {
      if (!acc[token.chainId]) {
        acc[token.chainId] = [];
      }
      acc[token.chainId].push(token);
      return acc;
    }, {} as Record<number, Token[]>);

    const feeTiers = [100, 500, 3000, 10000];

    // PHASE 1: Initialize pool registries for each network
    const poolRegistries: Record<number, PoolRegistry> = {};
    for (const chainId in tokensByChain) {
      poolRegistries[chainId] = await this.storageService.getPoolRegistry(parseInt(chainId, 10));
    }

    // PHASE 7: Initialize quarantine registries for each network
    const quarantineRegistries: Record<number, any> = {};
    for (const chainId in tokensByChain) {
      quarantineRegistries[chainId] = await this.storageService.getQuarantineRegistry(parseInt(chainId, 10));
    }

    for (const chainId in tokensByChain) {
      const chainTokens = tokensByChain[chainId];
      const chainIdNum = parseInt(chainId, 10);
      console.log(`Discovering pools for chain ID: ${chainIdNum}...`);

      for (let i = 0; i < chainTokens.length; i++) {
        for (let j = i + 1; j < chainTokens.length; j++) {
          const tokenA = chainTokens[i];
          const tokenB = chainTokens[j];

          for (const fee of feeTiers) {
            try {
              const poolAddress = await this.ethersAdapter.getPoolAddress(tokenA, tokenB, chainIdNum, fee);
              if (poolAddress) {
                // 3. Fetch initial pool state and prime cache
                const poolState: PoolState = await this.ethersAdapter.getPoolState(poolAddress, chainIdNum);
                sharedStateCache.setPoolState(poolAddress, poolState);

                // PHASE 1: Add to pool registry
                this.addPoolToRegistry(
                  poolRegistries[chainIdNum],
                  poolAddress,
                  poolState,
                  fee
                );
              }
              // Add delay between RPC calls to avoid rate limiting
              await this.delay(500);
            } catch (error: any) {
              // It's common for pools not to exist, so we can log this less verbosely
              // console.log(`Info: Pool not found for ${tokenA.symbol}-${tokenB.symbol} with fee ${fee}`);
            }
          }
        }
      }
    }

    // PHASE 1: Save pool registries to storage
    for (const chainId in poolRegistries) {
      await this.storageService.savePoolRegistry(parseInt(chainId, 10), poolRegistries[chainId]);
      console.log(`Pool registry saved for chain ${chainId}: ${Object.keys(poolRegistries[chainId].pools).length} pools`);
    }

    // PHASE 7: Save quarantine registries to storage
    for (const chainId in quarantineRegistries) {
      await this.storageService.saveQuarantineRegistry(parseInt(chainId, 10), quarantineRegistries[chainId]);
      const quarantineCount = Object.keys(quarantineRegistries[chainId].entries || {}).length;
      if (quarantineCount > 0) {
        console.log(`Quarantine registry saved for chain ${chainId}: ${quarantineCount} new tokens pending validation`);
      }
    }

    console.log('Pool discovery, registry building, and cache priming finished.');
  }

  /**
   * PHASE 1: Add a discovered pool to the pool registry
   * 
   * Creates pool metadata and pricing routes for both tokens in the pool.
   * Determines dexType (V2/V3) from fee presence.
   */
  private addPoolToRegistry(
    registry: PoolRegistry,
    poolAddress: string,
    poolState: PoolState,
    fee: number | undefined
  ): void {
    const { token0, token1 } = poolState;

    // Determine DEX type from fee (V3 has fee, V2 doesn't)
    const dexType = fee ? "v3" : "v2";
    const weight = dexType === "v3" ? 2 : 1;

    // Create pool metadata
    const poolMetadata: PoolMetadata = {
      address: poolAddress,
      dexType,
      token0,
      token1,
      feeTier: fee,
      weight,
    };

    // Add to registry
    registry.pools[poolAddress] = poolMetadata;

    // Create pricing routes (static, deterministic) with NORMALIZED (lowercase) keys
    // For now: each token routes through this pool to the other token
    // In production, routes would be more sophisticated (multi-hop, base selection)

    const token0Lower = token0.toLowerCase();
    const token1Lower = token1.toLowerCase();

    if (!registry.pricingRoutes[token0Lower]) {
      registry.pricingRoutes[token0Lower] = [];
    }
    if (!registry.pricingRoutes[token1Lower]) {
      registry.pricingRoutes[token1Lower] = [];
    }

    // Add route from token0 to token1
    registry.pricingRoutes[token0Lower].push({
      pool: poolAddress,
      base: token1,
    });

    // Add route from token1 to token0
    registry.pricingRoutes[token1Lower].push({
      pool: poolAddress,
      base: token0,
    });
  }

  /**
   * PHASE 7: Handle discovery of a new token
   * 
   * Route new tokens through quarantine instead of directly to primary registry.
   * Check if token already exists in primary before adding to quarantine.
   * Schedule validation asynchronously.
   * 
   * @param chainId Network chain ID
   * @param tokenAddress Token address discovered
   * @param metadata Token metadata
   * @param quarantine Current quarantine registry (modified in place)
   */
  private async handleNewTokenDiscovery(
    chainId: number,
    tokenAddress: string,
    metadata: TokenMetadata,
    quarantine: any
  ): Promise<void> {
    // Check if already in primary registry
    const primaryTokens = await this.storageService.getTokensByNetwork(chainId);
    if (primaryTokens.some(t => t.address === tokenAddress)) {
      return; // Already in primary - skip
    }

    // Check if already in quarantine
    if (quarantine.entries[tokenAddress]) {
      return; // Already quarantined - skip
    }

    // Add to quarantine
    quarantine.entries[tokenAddress] = {
      address: tokenAddress,
      metadata,
      discoveredAt: Date.now(),
      validationScheduled: false,
      promoted: false,
    };

    console.log(`📋 PHASE 7: New token ${tokenAddress.slice(0, 6)}... added to quarantine`);
  }

  /**
   * Periodically refreshes the state of all known pools in the cache.
   */
  async refreshPools(): Promise<void> {
    // This is a placeholder for a more sophisticated refresh mechanism.
    // In a real application, you'd get the list of pools from the cache keys
    // and update them in batches.
    console.log('Refreshing pool states...');
    // This is where we would iterate through the cached pools and update their state
    // For now, we will re-discover to refresh
    await this.discoverAndPrimeCache();
  }
}
