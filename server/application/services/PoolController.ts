/**
 * PHASE 2: PoolController - Pool-Centric Execution
 * 
 * RESPONSIBILITY:
 * - Receives token interest from UI (which pools are needed)
 * - Tracks which pools are "alive" (recently requested)
 * - Manages per-pool refresh scheduling and metadata
 * - Deduplicates pool addresses (N tokens → M pools where M < N)
 * - Supplies pool set to scheduler/executor
 * 
 * INVARIANT:
 * Controller is pool-centric, not token-centric.
 * This enables deduplication when N tokens share M pools.
 */

import { PricingRoute } from '../../domain/types';

/**
 * Per-pool liveness and scheduling metadata
 */
export interface AlivePool {
  address: string;
  chainId: number; // chain ID for this pool
  tier: "high" | "normal" | "low";
  nextRefresh: number; // timestamp when next refresh is due
  lastBlockSeen: number; // last block number from multicall results
  lastPrice: number; // last computed price
  requestCount: number; // total requests for this pool
  lastRequestTime: number; // timestamp of most recent request
  refCount: number; // number of active users requesting this pool
}

export class PoolController {
  /**
   * Alive set: pools that have recent interest
   * Keyed by pool address for O(1) lookup
   */
  private aliveSet: Map<string, AlivePool> = new Map();

  /**
   * PHASE 2: Handle token interest requests
   * 
   * When UI requests prices for a set of tokens, this method:
   * 1. Extracts pricing routes from each token's metadata
   * 2. For each route, adds pool to alive set (or increments refCount)
   * 3. Deduplicates pools automatically (Map prevents duplicates)
   * 
   * Result: N token requests → M pool tracking entries (M ≤ N)
   * 
   * @param tokens Array of tokens with attached pricingPools metadata
   * @param chainId Chain ID for the pools
   */
  public handleTokenInterest(
    tokens: Array<{ 
      address: string;
      pricingPools: PricingRoute[]
    }>,
    chainId: number = 1
  ): void {
    for (const token of tokens) {
      // Each token may have multiple pricing routes (e.g., 2-hop pricing)
      for (const route of token.pricingPools) {
        const poolAddress = route.pool;
        // Use chainId-prefixed key to avoid collisions between chains
        const poolKey = `${chainId}:${poolAddress}`;

        if (this.aliveSet.has(poolKey)) {
          // Pool already tracked - increment refCount and extend liveness
          const pool = this.aliveSet.get(poolKey)!;
          pool.refCount++;
          pool.lastRequestTime = Date.now();
          pool.requestCount++;
        } else {
          // New pool entering the alive set
          // Start with "high" tier (5s refresh) for new pools
          this.aliveSet.set(poolKey, {
            address: poolAddress,
            chainId: chainId,
            tier: "high",
            nextRefresh: Date.now() + 5000, // 5 seconds
            lastBlockSeen: 0,
            lastPrice: 0,
            requestCount: 1,
            lastRequestTime: Date.now(),
            refCount: 1, // First user
          });
        }
      }
    }
  }

  /**
   * Increment reference count for a pool
   * Called when a user starts watching this pool
   * 
   * @param poolAddress Pool contract address
   * @param chainId Chain ID
   */
  public incrementRefCount(poolAddress: string, chainId: number): void {
    const poolKey = `${chainId}:${poolAddress}`;
    const pool = this.aliveSet.get(poolKey);
    if (pool) {
      pool.refCount++;
      console.log(`📈 [POOL] refCount++ for ${poolAddress.slice(0, 6)}... (now ${pool.refCount})`);
    }
  }

  /**
   * Decrement reference count for a pool
   * Called when a user stops watching this pool
   * 
   * @param poolAddress Pool contract address
   * @param chainId Chain ID
   */
  public decrementRefCount(poolAddress: string, chainId: number): void {
    const poolKey = `${chainId}:${poolAddress}`;
    const pool = this.aliveSet.get(poolKey);
    if (pool) {
      pool.refCount = Math.max(0, pool.refCount - 1);
      console.log(`📉 [POOL] refCount-- for ${poolAddress.slice(0, 6)}... (now ${pool.refCount})`);
    }
  }

  /**
   * PHASE 2: Get pools due for refresh
   * 
   * Called by scheduler to determine which pools need querying.
   * Only returns pools where nextRefresh <= now()
   * 
   * @returns Array of pools ready for multicall execution
   */
  public getPoolsForRefresh(): AlivePool[] {
    const now = Date.now();
    return Array.from(this.aliveSet.values())
      .filter(pool => pool.nextRefresh <= now);
  }

  /**
   * PHASE 2: Get all pools in alive set
   * 
   * Returns complete set of currently tracked pools,
   * regardless of refresh timing. Useful for statistics.
   * 
   * @returns All pools in alive set
   */
  public getAliveSet(): AlivePool[] {
    return Array.from(this.aliveSet.values());
  }

  /**
   * PHASE 3 (future): Get count of alive pools
   * Useful for deduplication verification
   */
  public getAlivePoolCount(): number {
    return this.aliveSet.size;
  }

  /**
   * PHASE 3 (future): Update pool refresh timing based on volatility
   * Called after price computation with current price
   */
  public updatePoolTier(poolAddress: string, currentPrice: number): void {
    const pool = this.aliveSet.get(poolAddress);
    if (!pool) return;

    const priceDelta = pool.lastPrice > 0
      ? Math.abs(currentPrice - pool.lastPrice) / pool.lastPrice
      : 0;

    // Tiered scheduling based on price volatility
    if (priceDelta > 0.05) {
      // High volatility (>5%) - frequent refresh
      pool.tier = "high";
      pool.nextRefresh = Date.now() + 5000;
    } else if (priceDelta > 0.001) {
      // Normal volatility (0.1-5%) - standard refresh
      pool.tier = "normal";
      pool.nextRefresh = Date.now() + 10000;
    } else {
      // Low volatility (<0.1%) - relaxed refresh
      pool.tier = "low";
      pool.nextRefresh = Date.now() + 30000;
    }

    pool.lastPrice = currentPrice;
  }

  /**
   * PHASE 5 (future): Update block number seen
   * Called after multicall results received
   */
  public setBlockSeen(poolAddress: string, blockNumber: number): void {
    const pool = this.aliveSet.get(poolAddress);
    if (pool) {
      pool.lastBlockSeen = blockNumber;
    }
  }

  /**
   * PHASE 6: Remove a specific pool from alive set
   * Called by GCManager when pool's grace period expires
   * 
   * @param poolAddress Pool contract address
   * @param chainId Chain ID
   */
  public removePool(poolAddress: string, chainId: number): void {
    const poolKey = `${chainId}:${poolAddress}`;
    const removed = this.aliveSet.delete(poolKey);
    if (removed) {
      console.log(`🗑️ [POOL] Removed ${poolAddress.slice(0, 6)}... from alive set`);
    }
  }

  /**
   * PHASE 8 (future): Garbage collect stale pools
   * Removes pools with no requests in TTL window
   * Called periodically by GC timer
   */
  public pruneStalePools(ttlMs: number = 30000): void {
    const now = Date.now();
    const staleEntries: string[] = [];

    this.aliveSet.forEach((pool, address) => {
      if (now - pool.lastRequestTime > ttlMs) {
        staleEntries.push(address);
      }
    });

    staleEntries.forEach(address => this.aliveSet.delete(address));

    if (staleEntries.length > 0) {
      console.log(
        `🗑️ Pruned ${staleEntries.length} stale pools from alive set (TTL: ${ttlMs}ms)`
      );
    }
  }

  /**
   * PHASE 8 (future): Clear entire alive set
   * Useful for testing or manual reset
   */
  public clearAliveSet(): void {
    this.aliveSet.clear();
    console.log('🗑️ Cleared pool alive set');
  }

  /**
   * DEBUG: Get controller statistics
   */
  public getStats() {
    const pools = Array.from(this.aliveSet.values());
    const byTier = {
      high: pools.filter(p => p.tier === 'high').length,
      normal: pools.filter(p => p.tier === 'normal').length,
      low: pools.filter(p => p.tier === 'low').length,
    };

    return {
      totalPools: pools.length,
      byTier,
      poolsAveRequestCount: pools.length > 0
        ? pools.reduce((sum, p) => sum + p.requestCount, 0) / pools.length
        : 0,
    };
  }
}

// Export singleton instance
export const poolController = new PoolController();
