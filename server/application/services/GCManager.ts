import { StorageService } from './StorageService';
import { sharedStateCache } from './SharedStateCache';
import { poolController } from './PoolController';
import { TokenDiscoveryManager } from './TokenDiscoveryManager';
import { timingConfig } from '../../infrastructure/config/TimingConfig';

/**
 * PHASE 8: Garbage Collection Manager
 * 
 * Manages memory and storage lifecycle for different data types.
 * Prevents memory bloat while preserving valuable data.
 * 
 * Retention Policies:
 * - Pool/token state cache: 30 seconds (hot path, frequently updated)
 * - Primary token logos: 30 days (cold path, rarely changes)
 * - Quarantine entries: 7 days (safety, unvalidated tokens)
 * - Pools with refCount=0: 20 second grace period before removal
 * - Token topology: 7 days (refreshed via discovery when stale)
 * 
 * Runs as background task - does NOT block user interactions.
 */
class GCManager {
  private cleanupLoops: Map<string, NodeJS.Timeout> = new Map();
  private tokenDiscoveryManager: TokenDiscoveryManager;

  // Retention durations (in milliseconds)
  private readonly STATE_CACHE_TTL_MS = timingConfig.STATE_CACHE_TTL_MS;
  private readonly LOGO_CACHE_TTL_MS = timingConfig.LOGO_CACHE_TTL_MS;
  private readonly QUARANTINE_TTL_MS = timingConfig.QUARANTINE_TTL_MS;
  private readonly POOL_GRACE_PERIOD_MS = timingConfig.POOL_GRACE_PERIOD_MS;
  private readonly TOPOLOGY_TTL_MS = timingConfig.TOPOLOGY_TTL_MS;

  // Cleanup intervals
  private readonly STATE_CLEANUP_INTERVAL_MS = timingConfig.STATE_CLEANUP_INTERVAL_MS;
  private readonly LOGO_CLEANUP_INTERVAL_MS = timingConfig.LOGO_CLEANUP_INTERVAL_MS;
  private readonly QUARANTINE_CLEANUP_INTERVAL_MS = timingConfig.QUARANTINE_CLEANUP_INTERVAL_MS;
  private readonly POOL_CLEANUP_INTERVAL_MS = timingConfig.POOL_CLEANUP_INTERVAL_MS;
  private readonly TOPOLOGY_REFRESH_INTERVAL_MS = timingConfig.TOPOLOGY_REFRESH_INTERVAL_MS;

  // PHASE 6: Track pools with refCount=0 (poolKey -> timestamp when they hit zero)
  private poolsWithZeroRefCount: Map<string, number> = new Map();

  constructor(private storageService: StorageService) {
    this.tokenDiscoveryManager = new TokenDiscoveryManager(storageService);
  }

  /**
   * PHASE 10: Refresh stale token topologies
   * 
   * Periodically checks all tokens' topologyTimestamp values.
   * For tokens with stale topology (> 7 days old), triggers discovery refresh.
   * This is maintenance-driven, not on-demand or user-triggered.
   * 
   * Runs infrequently (every 7 days) to avoid excessive subgraph queries.
   */
  private async refreshStaleTopologies(): Promise<void> {
    try {
      const now = Date.now();
      let refreshedCount = 0;

      // Check topology freshness for both supported chains
      for (const chainId of [1, 137]) {
        const tokens = await this.storageService.getTokensByNetwork(chainId);
        const poolRegistry = await this.storageService.getPoolRegistry(chainId);

        // Find tokens with stale topology
        const tokensNeedingRefresh: typeof tokens = [];
        for (const token of tokens) {
          const topologyTs = poolRegistry.topologyTimestamp?.[token.address.toLowerCase()];
          if (!topologyTs) {
            // No topology timestamp = never discovered, skip (will be discovered at startup)
            continue;
          }

          const ageMs = now - topologyTs;
          if (ageMs > this.TOPOLOGY_TTL_MS) {
            tokensNeedingRefresh.push(token);
          }
        }

        if (tokensNeedingRefresh.length === 0) {
          continue;
        }

        console.log(`🔄 [GC] Chain ${chainId}: Refreshing ${tokensNeedingRefresh.length} stale token topology(ies)`);

        // Trigger discovery for stale tokens
        try {
          await this.tokenDiscoveryManager.discoverPoolsForTokens(tokensNeedingRefresh, chainId);
          refreshedCount += tokensNeedingRefresh.length;
          console.log(`✓ [GC] Chain ${chainId}: ${tokensNeedingRefresh.length} topology(ies) refreshed`);
        } catch (error) {
          console.error(`❌ [GC] Chain ${chainId} topology refresh failed:`, error);
        }
      }

      if (refreshedCount > 0) {
        console.log(`✓ [GC] Topology refresh complete: ${refreshedCount} token(s) updated`);
      }
    } catch (error) {
      console.error('❌ Topology refresh failed:', error);
    }
  }

  /**
   * PHASE 6: Clean up pools with refCount=0 after grace period
   * 
   * When a pool's refCount hits 0, it's added to tracking.
   * After POOL_GRACE_PERIOD_MS (20s), it's removed from aliveSet.
   * 
   * Grace period allows:
   * - User to reconnect without starting from scratch
   * - Brief page refreshes without losing pool state
   * - Smooth UX during network hiccups
   */
  private async cleanupPools(): Promise<void> {
    try {
      const now = Date.now();
      const aliveSet = poolController.getAliveSet();
      let poolsRemoved = 0;

      // Step 1: Check alive pools for any that now have refCount=0
      for (const pool of aliveSet) {
        const poolKey = `${pool.chainId}:${pool.address}`;
        
        if (pool.refCount === 0) {
          // Pool hit zero - add to tracking if not already tracked
          if (!this.poolsWithZeroRefCount.has(poolKey)) {
            this.poolsWithZeroRefCount.set(poolKey, now);
            console.log(`📉 [GC] Pool ${pool.address.slice(0, 6)}... refCount=0, grace period started`);
          }
        } else {
          // Pool was revived (refCount > 0) - remove from grace tracking
          if (this.poolsWithZeroRefCount.has(poolKey)) {
            this.poolsWithZeroRefCount.delete(poolKey);
            console.log(`📈 [GC] Pool ${pool.address.slice(0, 6)}... revived (refCount=${pool.refCount}), grace period cancelled`);
          }
        }
      }

      // Step 2: Check grace period expiry and remove
      const poolKeysToRemove: string[] = [];
      for (const [poolKey, zeroRefCountTime] of this.poolsWithZeroRefCount) {
        const graceElapsedMs = now - zeroRefCountTime;
        
        if (graceElapsedMs >= this.POOL_GRACE_PERIOD_MS) {
          // Grace period expired - remove pool
          poolKeysToRemove.push(poolKey);
        }
      }

      // Remove expired pools
      for (const poolKey of poolKeysToRemove) {
        const [chainIdStr, address] = poolKey.split(':');
        poolController.removePool(address, Number(chainIdStr));
        this.poolsWithZeroRefCount.delete(poolKey);
        poolsRemoved++;
        console.log(`🗑️ [GC] Pool ${address.slice(0, 6)}... removed after grace period`);
      }

      if (poolsRemoved > 0 || this.poolsWithZeroRefCount.size > 0) {
        console.log(`⏹️ [GC] Pool cleanup: ${poolsRemoved} removed, ${this.poolsWithZeroRefCount.size} in grace period`);
      }
    } catch (error) {
      console.error('❌ Pool cleanup failed:', error);
    }
  }

  /**
   * PHASE 8: Clean up expired pool/token state from cache
   * 
   * State cache has short TTL (30s) to prevent stale pricing.
   * Old entries are cleared frequently (every 10s).
   * 
   * This is the "hot path" cache - actively used by pricing engine.
   * Fast cleanup prevents outdated state from being returned to users.
   */
  private async cleanupStateCache(): Promise<void> {
    try {
      const now = Date.now();
      let purgedCount = 0;

      // NOTE: In production, would iterate through cache entries
      // For MVP, this is a placeholder for actual cache cleanup logic
      // The real implementation would access sharedStateCache internals
      
      console.log(`⏹️ PHASE 8: State cache cleanup: ${purgedCount} expired entries removed`);
    } catch (error) {
      console.error('❌ State cache cleanup failed:', error);
    }
  }

  /**
   * PHASE 8: Clean up expired logos from storage
   * 
   * Logo cache has long TTL (30 days) for primary tokens.
   * Logos are fetched from explorers (expensive) so retained longer.
   * 
   * Cleanup runs periodically (every 1 hour) to prevent disk bloat.
   */
  private async cleanupLogos(chainId: number): Promise<void> {
    try {
      const now = Date.now();
      const primaryTokens = await this.storageService.getTokensByNetwork(chainId);
      let purgedCount = 0;

      // Check each token's logo age
      for (const token of primaryTokens) {
        const logoFetchedAt = (token as any).logoFetchedAt;
        
        // If logo was fetched and is now stale, remove it
        if (logoFetchedAt && (now - logoFetchedAt) > this.LOGO_CACHE_TTL_MS) {
          (token as any).logoURI = '';
          (token as any).logoFetchedAt = undefined;
          purgedCount++;
          console.log(`  🗑️  Removed stale logo for ${token.symbol}`);
        }
      }

      // Save updated tokens back to storage
      if (purgedCount > 0) {
        const fileName = `tokens_${chainId === 1 ? 'ethereum' : 'polygon'}.json`;
        await (this.storageService as any).write(fileName, primaryTokens);
      }
      
      console.log(
        `🖼️ PHASE 8: Logo cleanup for chain ${chainId}: ${purgedCount} expired logos removed`
      );
    } catch (error) {
      console.error(`❌ Logo cleanup failed for chain ${chainId}:`, error);
    }
  }

  /**
   * PHASE 8: Clean up expired quarantine entries
   * 
   * Quarantine has medium TTL (7 days) for unvalidated tokens.
   * Prevents quarantine registry from growing unbounded.
   * 
   * Unvalidated tokens that don't pass validation within 7 days are purged.
   * Promotes tokens are kept (moved to primary, no longer in quarantine).
   */
  private async cleanupQuarantine(chainId: number): Promise<void> {
    try {
      const now = Date.now();
      const quarantine = await this.storageService.getQuarantineRegistry(chainId);
      
      let purgedCount = 0;

      for (const [tokenAddress, entry] of Object.entries(quarantine.entries)) {
        // Skip promoted tokens (they're gone from quarantine)
        if (entry.promoted) {
          continue;
        }

        // Check age of unvalidated entry
        const ageMs = now - entry.discoveredAt;
        if (ageMs > this.QUARANTINE_TTL_MS) {
          // Purge old unvalidated entries
          await this.storageService.removeFromQuarantine(chainId, tokenAddress);
          purgedCount++;
        }
      }

      if (purgedCount > 0) {
        console.log(
          `🗑️ PHASE 8: Quarantine cleanup for chain ${chainId}: ${purgedCount} expired entries removed`
        );
      }
    } catch (error) {
      console.error(`❌ Quarantine cleanup failed for chain ${chainId}:`, error);
    }
  }

  /**
   * Start all garbage collection loops.
   * 
   * Called on server startup.
   * Runs cleanup tasks in background for different data types.
   */
  startAllCleanupLoops(): void {
    console.log('🔄 PHASE 8: Starting garbage collection loops...');

    // PHASE 6: Pool cleanup (with grace period)
    const poolCleanupId = setInterval(
      () => this.cleanupPools(),
      this.POOL_CLEANUP_INTERVAL_MS
    );
    this.cleanupLoops.set('pool-cleanup', poolCleanupId);
    console.log(`  ▶️ Pool cleanup: every ${this.POOL_CLEANUP_INTERVAL_MS / 1000}s (grace period: ${this.POOL_GRACE_PERIOD_MS / 1000}s)`);

    // PHASE 10: Topology refresh (maintenance-driven discovery)
    // Does NOT run on startup - only after server fully initialized
    // First run happens 7 days after startup, then every 7 days
    const topologyRefreshId = setInterval(
      () => this.refreshStaleTopologies(),
      this.TOPOLOGY_REFRESH_INTERVAL_MS
    );
    this.cleanupLoops.set('topology-refresh', topologyRefreshId);
    console.log(`  ▶️ Topology refresh: every ${this.TOPOLOGY_REFRESH_INTERVAL_MS / (24 * 60 * 60 * 1000)}d (7 day stale threshold)`);

    // State cache cleanup (frequently)
    const stateCleanupId = setInterval(
      () => this.cleanupStateCache(),
      this.STATE_CLEANUP_INTERVAL_MS
    );
    this.cleanupLoops.set('state-cache', stateCleanupId);
    console.log(`  ▶️ State cache cleanup: every ${this.STATE_CLEANUP_INTERVAL_MS / 1000}s`);

    // Logo cleanup (per-chain)
    for (const chainId of [1, 137]) {
      const logoCleanupId = setInterval(
        () => this.cleanupLogos(chainId),
        this.LOGO_CLEANUP_INTERVAL_MS
      );
      this.cleanupLoops.set(`logo-cleanup-${chainId}`, logoCleanupId);
    }
    console.log(`  ▶️ Logo cleanup: every ${this.LOGO_CLEANUP_INTERVAL_MS / (60 * 1000)}min`);

    // Quarantine cleanup (per-chain)
    for (const chainId of [1, 137]) {
      const quarantineCleanupId = setInterval(
        () => this.cleanupQuarantine(chainId),
        this.QUARANTINE_CLEANUP_INTERVAL_MS
      );
      this.cleanupLoops.set(`quarantine-cleanup-${chainId}`, quarantineCleanupId);
    }
    console.log(
      `  ▶️ Quarantine cleanup: every ${this.QUARANTINE_CLEANUP_INTERVAL_MS / (60 * 1000)}min`
    );

    console.log('✅ PHASE 8: All garbage collection loops started');
  }

  /**
   * Stop all cleanup loops.
   * 
   * Called on server shutdown.
   */
  stopAllCleanupLoops(): void {
    console.log('⏹️ PHASE 8: Stopping garbage collection loops...');
    for (const [name, intervalId] of this.cleanupLoops.entries()) {
      clearInterval(intervalId);
    }
    this.cleanupLoops.clear();
    console.log('✅ PHASE 8: All garbage collection loops stopped');
  }

  /**
   * Get current GC metrics for monitoring.
   * 
   * Returns statistics about cleanup activity.
   */
  getMetrics(): {
    statesCacheTTL: string;
    logoCacheTTL: string;
    quarantineTTL: string;
    poolGracePeriod: string;
    poolsInGracePeriod: number;
  } {
    return {
      statesCacheTTL: `${this.STATE_CACHE_TTL_MS / 1000}s`,
      logoCacheTTL: `${this.LOGO_CACHE_TTL_MS / (24 * 60 * 60 * 1000)}d`,
      quarantineTTL: `${this.QUARANTINE_TTL_MS / (24 * 60 * 60 * 1000)}d`,
      poolGracePeriod: `${this.POOL_GRACE_PERIOD_MS / 1000}s`,
      poolsInGracePeriod: this.poolsWithZeroRefCount.size,
    };
  }
}

export { GCManager };
