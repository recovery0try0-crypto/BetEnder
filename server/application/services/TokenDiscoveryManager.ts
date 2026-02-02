/**
 * TokenDiscoveryManager - Subgraph-Based Pool Discovery
 * 
 * RESPONSIBILITY:
 * - Discover pools for tokens via subgraph queries (no on-chain guessing)
 * - For each token, query all DEX subgraphs
 * - Find pools paired with base tokens
 * - Rank by liquidity and keep pools contributing ≥90% total liquidity
 * - Store topology with per-token timestamp for 7-day TTL
 * - Track discovery attempts to prevent duplicate queries within 5-min window
 */

import { StorageService } from './StorageService';
import { Token } from '../../domain/entities';
import { PoolRegistry, PoolMetadata, PricingRoute } from '../../domain/types';
import { subgraphConfig, BASE_TOKENS } from '../../infrastructure/config/SubgraphConfig';
import { timingConfig } from '../../infrastructure/config/TimingConfig';

interface DiscoveryAttempt {
  tokenAddress: string;
  chainId: number;
  attemptedAt: number;
  poolsFound: number;
  succeeded: boolean;
}

interface SubgraphPool {
  id: string; // Pool address
  token0: {
    id: string;
    symbol: string;
    decimals: string;
  };
  token1: {
    id: string;
    symbol: string;
    decimals: string;
  };
  reserveUSD: string;
  liquidity?: string; // V3 only
  feeTier?: string; // V3 only
}

export class TokenDiscoveryManager {
  private discoveryAttempts: Map<string, DiscoveryAttempt> = new Map();
  private readonly DISCOVERY_RETRY_WINDOW = timingConfig.DISCOVERY_RETRY_WINDOW_MS;
  private readonly LIQUIDITY_THRESHOLD = timingConfig.LIQUIDITY_THRESHOLD;
  private readonly TTL_7_DAYS = timingConfig.DISCOVERY_TOPOLOGY_TTL_MS;

  constructor(private storageService: StorageService) {}

  /**
   * Discover pools for multiple tokens using subgraph queries
   * 
   * For each token:
   * 1. Query all subgraphs configured for the chain
   * 2. Find pools where token is paired with a base token
   * 3. Rank by liquidity, keep top pools contributing ≥90%
   * 4. Store in registry with timestamp for TTL tracking
   * 
   * @param tokens Tokens to discover pools for
   * @param chainId Network chain ID
   * @returns Total number of pools discovered
   */
  public async discoverPoolsForTokens(tokens: Token[], chainId: number): Promise<number> {
    console.log(`🔍 [SUBGRAPH DISCOVERY] Discovering pools for ${tokens.length} token(s) on chain ${chainId}`);
    
    const poolRegistry = await this.storageService.getPoolRegistry(chainId);
    let poolsDiscoveredThisBatch = 0;

    // Initialize topologyTimestamp map if missing
    if (!poolRegistry.topologyTimestamp) {
      poolRegistry.topologyTimestamp = {};
    }

    for (const token of tokens) {
      const attemptKey = `${token.address.toLowerCase()}-${chainId}`;
      
      // Check if already discovered recently (within 5-min retry window)
      const lastAttempt = this.discoveryAttempts.get(attemptKey);
      if (lastAttempt && (Date.now() - lastAttempt.attemptedAt) < this.DISCOVERY_RETRY_WINDOW) {
        console.log(`⏭️  Skipping ${token.symbol}: already attempted ${Math.round((Date.now() - lastAttempt.attemptedAt) / 1000)}s ago`);
        continue;
      }

      console.log(`\n🔎 Discovering pools for ${token.symbol} (${token.address.slice(0, 6)}...)`);
      let poolsFoundForToken = 0;

      try {
        // Query all subgraphs for this chain
        const subgraphs = subgraphConfig[chainId] || [];
        const allPools: SubgraphPool[] = [];

        for (const subgraph of subgraphs) {
          console.log(`   → Querying ${subgraph.name}...`);
          try {
            const pools = await this.querySubgraphForToken(token.address, subgraph, chainId);
            allPools.push(...pools);
            console.log(`     ✓ Found ${pools.length} pool(s)`);
          } catch (error: any) {
            console.warn(`     ⚠️  Query failed: ${error.message}`);
          }
        }

        // Rank pools by liquidity and filter to 90% threshold
        const rankedPools = this.filterPoolsByLiquidity(allPools, this.LIQUIDITY_THRESHOLD);
        console.log(`   → After 90% filtering: ${rankedPools.length} pool(s)`);

        // Add pools to registry
        for (const pool of rankedPools) {
          this.addPoolToRegistry(poolRegistry, pool, chainId);
          poolsFoundForToken++;
          poolsDiscoveredThisBatch++;
        }

        // Record timestamp for this token's topology (TTL tracking)
        const tokenLower = token.address.toLowerCase();
        poolRegistry.topologyTimestamp![tokenLower] = Date.now();

        // Record successful discovery attempt
        this.discoveryAttempts.set(attemptKey, {
          tokenAddress: token.address,
          chainId,
          attemptedAt: Date.now(),
          poolsFound: poolsFoundForToken,
          succeeded: true,
        });

        console.log(`   ✓ ${token.symbol}: Added ${poolsFoundForToken} pool(s) to registry`);
      } catch (error: any) {
        console.error(`   ✗ Error discovering pools for ${token.symbol}:`, error.message);

        // Record failed attempt
        this.discoveryAttempts.set(attemptKey, {
          tokenAddress: token.address,
          chainId,
          attemptedAt: Date.now(),
          poolsFound: 0,
          succeeded: false,
        });
      }
    }

    // Save updated registry
    await this.storageService.savePoolRegistry(chainId, poolRegistry);
    console.log(`\n✅ [SUBGRAPH DISCOVERY] Complete: ${poolsDiscoveredThisBatch} total pools discovered`);
    
    return poolsDiscoveredThisBatch;
  }

  /**
   * Check if token topology needs refresh based on TTL
   * 
   * @param tokenAddress Token address (lowercase)
   * @param chainId Network chain ID
   * @returns true if timestamp missing or older than 7 days
   */
  public async isTopologyStale(tokenAddress: string, chainId: number): Promise<boolean> {
    const poolRegistry = await this.storageService.getPoolRegistry(chainId);
    const tokenLower = tokenAddress.toLowerCase();

    // Missing timestamp = stale
    if (!poolRegistry.topologyTimestamp?.[tokenLower]) {
      return true;
    }

    // Check age
    const timestamp = poolRegistry.topologyTimestamp[tokenLower];
    const age = Date.now() - timestamp;
    const isStale = age > this.TTL_7_DAYS;

    if (isStale) {
      console.log(`⏰ Topology for ${tokenAddress.slice(0, 6)}... is stale (${Math.round(age / (24 * 60 * 60 * 1000))}d old)`);
    }

    return isStale;
  }

  /**
   * Query a subgraph for pools involving a specific token and base tokens
   * 
   * @param tokenAddress Target token address
   * @param subgraph Subgraph configuration
   * @param chainId Network chain ID
   * @returns Array of pools from subgraph
   */
  private async querySubgraphForToken(
    tokenAddress: string,
    subgraph: typeof subgraphConfig[1][0],
    chainId: number
  ): Promise<SubgraphPool[]> {
    const baseTokens = BASE_TOKENS[chainId] || [];
    const tokenLower = tokenAddress.toLowerCase();
    const baseTokensLower = baseTokens.map(t => t.toLowerCase());

    // Build query: find pools where token is paired with any base token
    const query = this.buildPoolQuery(tokenLower, baseTokensLower, subgraph.dexType);

    try {
      const response = await fetch(subgraph.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as any;

      if (data.errors) {
        throw new Error(data.errors[0]?.message || 'Subgraph error');
      }

      // Extract pools from response (structure varies by subgraph)
      const pools = data.data?.pairs || data.data?.pools || [];
      return pools;
    } catch (error: any) {
      throw new Error(`Failed to query ${subgraph.name}: ${error.message}`);
    }
  }

  /**
   * Build GraphQL query for pool discovery
   * 
   * Queries depend on DEX type (V2 uses "pairs", V3 uses "pools")
   */
  private buildPoolQuery(tokenAddress: string, baseTokens: string[], dexType: string): string {
    const baseTokenFilters = baseTokens.map(addr => `"${addr}"`).join(',');

    if (dexType === 'v2') {
      // V2: Query for pairs involving the token and any base token
      return `{
        pairs(
          first: 1000
          where: {
            or: [
              { token0: "${tokenAddress}", token1_in: [${baseTokenFilters}] }
              { token1: "${tokenAddress}", token0_in: [${baseTokenFilters}] }
            ]
          }
          orderBy: reserveUSD
          orderDirection: desc
        ) {
          id
          token0 { id symbol decimals }
          token1 { id symbol decimals }
          reserveUSD
        }
      }`;
    } else {
      // V3: Query for pools involving the token and any base token
      return `{
        pools(
          first: 1000
          where: {
            or: [
              { token0: "${tokenAddress}", token1_in: [${baseTokenFilters}] }
              { token1: "${tokenAddress}", token0_in: [${baseTokenFilters}] }
            ]
          }
          orderBy: totalValueLockedUSD
          orderDirection: desc
        ) {
          id
          token0 { id symbol decimals }
          token1 { id symbol decimals }
          reserveUSD: totalValueLockedUSD
          feeTier
          liquidity
        }
      }`;
    }
  }

  /**
   * Filter pools by liquidity threshold
   * 
   * Rank by reserveUSD, keep pools that cumulatively contribute ≥90% of total
   */
  private filterPoolsByLiquidity(pools: SubgraphPool[], threshold: number): SubgraphPool[] {
    if (pools.length === 0) return [];

    // Parse liquidity values and sort descending
    type PoolWithParsedLiquidity = SubgraphPool & { __liquidity: number };

    const parsed: PoolWithParsedLiquidity[] = pools
      .map(p => ({
        ...p,
        __liquidity: parseFloat(p.reserveUSD || '0'),
      })) as PoolWithParsedLiquidity[];

    const sorted = parsed.sort((a, b) => b.__liquidity - a.__liquidity);

    const totalLiquidity = sorted.reduce((sum, p) => sum + p.__liquidity, 0);
    if (totalLiquidity === 0) return [];

    // Keep pools until cumulative threshold reached
    let cumulativeLiquidity = 0;
    const filtered: SubgraphPool[] = [];

    for (const pool of sorted) {
      cumulativeLiquidity += pool.__liquidity;
      // Return the pool without the temporary property
      const { __liquidity, ...poolData } = pool;
      filtered.push(poolData as SubgraphPool);

      if (cumulativeLiquidity / totalLiquidity >= threshold) {
        break;
      }
    }

    console.log(`   Liquidity: total=${totalLiquidity.toFixed(0)}, kept=${cumulativeLiquidity.toFixed(0)} (${(cumulativeLiquidity / totalLiquidity * 100).toFixed(1)}%)`);
    return filtered;
  }

  /**
   * Add a discovered pool to the registry
   * 
   * Creates pool metadata and pricing routes for both tokens
   */
  private addPoolToRegistry(
    registry: PoolRegistry,
    pool: SubgraphPool,
    chainId: number
  ): void {
    const poolAddress = pool.id.toLowerCase();
    const token0 = pool.token0.id.toLowerCase();
    const token1 = pool.token1.id.toLowerCase();

    // Determine DEX type (V3 has feeTier)
    const dexType = pool.feeTier ? 'v3' : 'v2';
    const weight = dexType === 'v3' ? 2 : 1;

    // Create pool metadata
    const poolMetadata: PoolMetadata = {
      address: poolAddress,
      dexType,
      token0,
      token1,
      feeTier: pool.feeTier ? parseInt(pool.feeTier, 10) : undefined,
      weight,
    };

    // Add to registry
    registry.pools[poolAddress] = poolMetadata;

    // Create pricing routes
    if (!registry.pricingRoutes[token0]) {
      registry.pricingRoutes[token0] = [];
    }
    if (!registry.pricingRoutes[token1]) {
      registry.pricingRoutes[token1] = [];
    }

    // Add routes
    registry.pricingRoutes[token0].push({
      pool: poolAddress,
      base: token1,
    });

    registry.pricingRoutes[token1].push({
      pool: poolAddress,
      base: token0,
    });
  }
}
