
import { EthersAdapter } from '../../infrastructure/adapters/EthersAdapter';
import { StorageService } from './StorageService';
import { TokenDiscoveryManager } from './TokenDiscoveryManager';
import { Token } from '../../domain/entities';
import { sharedStateCache } from './SharedStateCache';
import { PoolState, TokenMetadata, PoolRegistry } from '../../domain/types';
import { explorerConfig } from '../../infrastructure/config/ExplorerConfig';

export class DiscoveryService {
  private tokenDiscoveryManager: TokenDiscoveryManager;

  constructor(
    private readonly storageService: StorageService,
    private readonly ethersAdapter: EthersAdapter,
  ) {
    this.tokenDiscoveryManager = new TokenDiscoveryManager(storageService);
  }

  // Add delay between RPC calls to avoid rate limiting
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async discoverAndPrimeCache(): Promise<void> {
    console.log('Starting pool and token discovery to prime the cache...');
    console.log('🔍 PHASE 1: Fetching token metadata via Explorer APIs (Cold Path)');
    
    // Get all tokens from all networks (both Ethereum and Polygon)
    const ethTokens: Token[] = await this.storageService.getTokensByNetwork(1);
    const polygonTokens: Token[] = await this.storageService.getTokensByNetwork(137);
    const tokens = [...ethTokens, ...polygonTokens];

    // PHASE 1: Prime Token Metadata (with batching to avoid rate limiting)
    console.log(`\n📋 Priming metadata for ${tokens.length} tokens...`);
    
    // FIX #4: Batch fetch metadata in groups of 10 to parallelize while respecting rate limits
    const BATCH_SIZE = 10;
    const BATCH_DELAY_MS = 100; // Delay between batches, not per-token
    
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE);
      
      const metadataPromises = batch.map(async (token) => {
        try {
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
                  decimals: parseInt(info.divisor || info.decimals || token.decimals.toString()),
                  logoURI: info.logo || info.logoURI || '',
                  logoFetchedAt: (info.logo || info.logoURI) ? Date.now() : undefined,
                };
                console.log(`  ✓ ${token.symbol} metadata fetched via Explorer API (with logo)`);
              }
            }
          } catch (e) {
            console.warn(`  ⚠️  Explorer metadata fetch failed for ${token.symbol}, falling back to RPC`);
          }

          if (!metadata) {
            metadata = await this.ethersAdapter.getTokenMetadata(token.address, token.chainId);
          }
          
          sharedStateCache.setTokenMetadata(token.address, metadata);
        } catch (error: any) {
          console.error(`  ✗ Error fetching metadata for ${token.symbol}:`, error.message);
        }
      });

      // Wait for entire batch to complete
      await Promise.all(metadataPromises);
      
      // Delay between batches (not per-token)
      if (i + BATCH_SIZE < tokens.length) {
        await this.delay(BATCH_DELAY_MS);
      }
    }
    console.log('✅ Token metadata cache priming complete.\n');

    // PHASE 2: Discover Pool Topology using Subgraphs
    console.log('🔍 PHASE 2: Discovering pool topology via subgraphs...');
    const tokensByChain = tokens.reduce((acc, token) => {
      if (!acc[token.chainId]) {
        acc[token.chainId] = [];
      }
      acc[token.chainId].push(token);
      return acc;
    }, {} as Record<number, Token[]>);

    // For each chain, discover pools for tokens with stale/missing topology
    for (const chainIdStr in tokensByChain) {
      const chainId = parseInt(chainIdStr, 10);
      const chainTokens = tokensByChain[chainId];

      console.log(`\n📍 Chain ${chainId}: Checking ${chainTokens.length} tokens for stale topology...`);

      // Check which tokens need topology refresh
      const tokensNeedingDiscovery: Token[] = [];
      for (const token of chainTokens) {
        const isStale = await this.tokenDiscoveryManager.isTopologyStale(token.address, chainId);
        if (isStale) {
          tokensNeedingDiscovery.push(token);
        }
      }

      if (tokensNeedingDiscovery.length === 0) {
        console.log(`  ✓ All ${chainTokens.length} tokens have fresh topology (< 7 days)`);
        continue;
      }

      console.log(`  → ${tokensNeedingDiscovery.length} token(s) need topology refresh`);

      // Discover pools for stale tokens using subgraphs
      try {
        await this.tokenDiscoveryManager.discoverPoolsForTokens(tokensNeedingDiscovery, chainId);
      } catch (error: any) {
        console.error(`  ✗ Error discovering pools for chain ${chainId}:`, error.message);
      }
    }

    console.log('\n✅ Pool discovery and topology update complete.');
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
