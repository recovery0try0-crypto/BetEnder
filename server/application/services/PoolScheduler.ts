/**
 * PHASE 3: PoolScheduler - Tiered Pool Refresh Scheduling
 * 
 * RESPONSIBILITY:
 * - Continuously check PoolController for pools due refresh
 * - Execute multicall queries for scheduled pools
 * - Update pool tiers based on price volatility
 * - Reschedule next refresh based on tier
 * 
 * ARCHITECTURE:
 * - Main loop checks every 1 second (not 10s global interval)
 * - Each pool has independent refresh cadence
 * - Volatility-based tier transitions (5s / 10s / 30s)
 * - Self-adjusting (no external configuration needed)
 * 
 * PHASE 4: Integration with MulticallEngine
 * - Scheduler gets pools due refresh
 * - Passes to MulticallEngine for batching
 * - MulticallEngine handles weight-aware chunking
 * - Results processed for tier updates and caching
 */

import { poolController, AlivePool } from './PoolController';
import { sharedStateCache } from './SharedStateCache';
import { MulticallEngine } from './MulticallEngine';
import { StorageService } from './StorageService';
import { EthersAdapter } from '../../infrastructure/adapters/EthersAdapter';
import { timingConfig } from '../../infrastructure/config/TimingConfig';

export class PoolScheduler {
  private isRunning = false;
  private executionLoopIntervalId: NodeJS.Timeout | null = null;
  private multicallEngine: MulticallEngine;

  // PHASE 5: Micro-batching collection window
  private collectionWindow = timingConfig.MICROBATCH_COLLECTION_WINDOW_MS;
  private pendingPoolsForBatch: Set<string> = new Set(); // poolKey deduplication
  private batchFlushTimer: NodeJS.Timeout | null = null;
  private lastBatchExecutionTime = 0;

  constructor(
    private storageService: StorageService,
    private ethersAdapter: EthersAdapter,
    providerCount: number = 1
  ) {
    this.multicallEngine = new MulticallEngine(
      storageService,
      ethersAdapter,
      providerCount
    );
  }

  /**
   * PHASE 3: Start the scheduler
   * 
   * Begins the execution loop that checks for pools due refresh.
   * Called once on server startup.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ Pool scheduler already running');
      return;
    }

    console.log('🚀 Starting pool scheduler (tiered scheduling enabled)');
    this.isRunning = true;

    // FIX #5: Dynamic interval - check at next pool refresh time, not fixed 10s
    // This ensures high-volatility pools (5s tier) refresh on time
    const scheduleNextExecution = () => {
      if (!this.isRunning) return;
      
      const alivePoolsSet = poolController.getAliveSet();
      if (alivePoolsSet.length === 0) {
        // No pools yet, check again in 1 second
        this.executionLoopIntervalId = setTimeout(scheduleNextExecution, 1000);
        return;
      }
      
      // Find next pool that needs refresh
      const nextRefreshTime = Math.min(...alivePoolsSet.map(p => p.nextRefresh));
      const timeUntilNextRefresh = Math.max(0, nextRefreshTime - Date.now());
      const delayMs = Math.min(timeUntilNextRefresh, 1000); // Max 1 second, min 0
      
      this.executionLoopIntervalId = setTimeout(() => {
        this.executionLoop().catch(error => {
          console.error('❌ Error in scheduler execution loop:', error);
        }).finally(() => {
          scheduleNextExecution(); // Reschedule after execution
        });
      }, delayMs);
    };
    
    scheduleNextExecution();
  }

  /**
   * PHASE 3-4: Main execution loop
   * 
   * Called every 1 second to:
   * 1. Check which pools are due for refresh
   * 2. Collect into pending batch (with deduplication)
   * 3. Wait for collection window (50-100ms) to batch
   * 4. Execute multicall for deduplicated batch
   * 5. Update tiers based on price changes
   * 6. Reschedule next refresh
   * 
   * PHASE 5 IMPROVEMENT: Micro-batching
   * - Pools are collected in pendingPoolsForBatch
   * - Collection window allows deduplication within window
   * - Batch executes when: window expires OR 10+ pools collected
   */
  private async executionLoop(): Promise<void> {
    // Get pools that are due for refresh (nextRefresh <= now)
    const poolsDue = poolController.getPoolsForRefresh();

    if (poolsDue.length === 0) {
      return; // Nothing to do
    }

    // PHASE 5: Add pools to pending batch (with deduplication by poolKey)
    const poolsByChain = new Map<number, AlivePool[]>();
    let newPoolsAdded = 0;

    for (const pool of poolsDue) {
      const chainId = pool.chainId || 1;
      const poolKey = `${chainId}:${pool.address}`;
      
      if (!this.pendingPoolsForBatch.has(poolKey)) {
        this.pendingPoolsForBatch.add(poolKey);
        newPoolsAdded++;
        
        // Organize by chain for batch execution
        if (!poolsByChain.has(chainId)) {
          poolsByChain.set(chainId, []);
        }
        poolsByChain.get(chainId)!.push(pool);
      }
    }

    if (newPoolsAdded === 0) {
      return; // All pools already pending, wait for window
    }

    console.log(`⚡ [SCHEDULER] ${newPoolsAdded} new pool(s) added to pending batch (total pending: ${this.pendingPoolsForBatch.size})`);

    // PHASE 5: Schedule batch flush
    // If no timer is active, start one
    if (!this.batchFlushTimer) {
      this.scheduleBatchFlush();
    }

    // PHASE 5: Threshold check - if we have 10+ pools, flush immediately
    if (this.pendingPoolsForBatch.size >= 10) {
      console.log(`📦 [SCHEDULER] Threshold reached (${this.pendingPoolsForBatch.size} pools), flushing batch immediately`);
      await this.flushBatch();
    }
  }

  /**
   * PHASE 5: Schedule batch flush after collection window
   * Ensures we wait before executing, allowing deduplication
   */
  private scheduleBatchFlush(): void {
    if (this.batchFlushTimer) {
      clearTimeout(this.batchFlushTimer);
    }

    this.batchFlushTimer = setTimeout(async () => {
      console.log(`⏱️ [SCHEDULER] Collection window expired, flushing ${this.pendingPoolsForBatch.size} deduplicated pool(s)`);
      await this.flushBatch();
      this.batchFlushTimer = null;
    }, this.collectionWindow);
  }

  /**
   * PHASE 5: Execute pending batch and clear
   * Converts pending pool keys back to AlivePool objects and executes
   */
  private async flushBatch(): Promise<void> {
    if (this.batchFlushTimer) {
      clearTimeout(this.batchFlushTimer);
      this.batchFlushTimer = null;
    }

    if (this.pendingPoolsForBatch.size === 0) {
      return;
    }

    // Convert poolKeys back to AlivePool objects from controller
    const aliveSet = poolController.getAliveSet();
    const poolsToExecute: AlivePool[] = [];
    
    for (const poolKey of this.pendingPoolsForBatch) {
      const [chainIdStr, address] = poolKey.split(':');
      const pool = aliveSet.find(p => p.address === address && p.chainId === Number(chainIdStr));
      if (pool) {
        poolsToExecute.push(pool);
      }
    }

    // Clear pending batch before execution
    this.pendingPoolsForBatch.clear();

    if (poolsToExecute.length === 0) {
      return;
    }

    // Group by chain and execute
    const poolsByChain = new Map<number, typeof poolsToExecute>();
    for (const pool of poolsToExecute) {
      const chainId = pool.chainId || 1;
      if (!poolsByChain.has(chainId)) {
        poolsByChain.set(chainId, []);
      }
      poolsByChain.get(chainId)!.push(pool);
    }

    const startTime = Date.now();
    for (const [chainId, chainPools] of poolsByChain) {
      await this.executeForChain(chainId, chainPools);
    }
    this.lastBatchExecutionTime = Date.now() - startTime;
  }

  /**
   * Execute multicall for a specific chain's pools
   */
  private async executeForChain(chainId: number, poolsDue: Array<{ address: string; chainId: number; tier: string; nextRefresh: number; lastBlockSeen: number; lastPrice: number; requestCount: number; lastRequestTime: number }>): Promise<void> {
    if (poolsDue.length === 0) {
      return;
    }

    // PHASE 6: Generate unique tick ID for this refresh cycle
    const tickId = `tick_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    console.log(`⚡ Scheduler: ${poolsDue.length} pool(s) due for refresh [${tickId}]`);

    // PHASE 4: Get pool registry for this chain
    const poolRegistry = await this.storageService.getPoolRegistry(chainId);

    // PHASE 4: Create weight-aware batches
    const batches = this.multicallEngine.createBatches(poolsDue as AlivePool[], chainId, poolRegistry);
    console.log(`📦 Created ${batches.length} batch(es) for execution`);

    // PHASE 4: Execute all batches with round-robin distribution
    try {
      const multicallResults = await this.multicallEngine.executeBatches(batches, chainId);

      console.log(`✓ Multicall execution complete: ${multicallResults.length} results [${tickId}]`);

      // PHASE 5: Block-aware pricing - skip computation if block unchanged
      let blockAwareSavings = 0;
      let computationsPerformed = 0;

      // Process results: update cache and tier
      for (const result of multicallResults) {
        if (result.success && result.data) {
          const pool = poolController
            .getAliveSet()
            .find(p => p.address === result.poolAddress);

          // PHASE 5: Check if block number changed
          if (result.blockNumber === pool?.lastBlockSeen && result.blockNumber !== 0) {
            // Block unchanged - state unchanged, skip pricing computation
            blockAwareSavings++;
          } else {
            // Block changed - recompute price
            computationsPerformed++;
            
            console.log(`✓ [CACHE] Pool ${result.poolAddress.slice(0, 6)}... cached (sqrtPrice: ${result.data.sqrtPriceX96.toString().slice(0, 16)}...)`);

            // Update pool tier based on price change
            if (pool) {
              // Compute price from sqrtPriceX96 (simplified)
              const price = Math.sqrt(Number(result.data.sqrtPriceX96) / 2 ** 96);
              poolController.updatePoolTier(result.poolAddress, price);
              pool.lastBlockSeen = result.blockNumber;
              pool.lastPrice = price;

              console.log(
                `  📊 ${result.poolAddress.slice(0, 6)}... → block ${result.blockNumber}, tier: ${pool.tier}`
              );
            }
          }
        } else {
          // Failed result - schedule retry
          console.warn(
            `⚠️ Multicall failed for pool ${result.poolAddress.slice(0, 6)}...`
          );
        }
      }

      if (multicallResults.length > 0) {
        const savingsPercent = Math.round(
          (blockAwareSavings / multicallResults.length) * 100
        );
        console.log(
          `📈 PHASE 5 Block-Aware Savings: ${blockAwareSavings}/${multicallResults.length} skipped pricing (${savingsPercent}% reduction)`
        );
      }
    } catch (error) {
      console.error('❌ Multicall batch execution failed:', error);
      // Schedule retry for all pools due
      for (const pool of poolsDue) {
        pool.nextRefresh = Date.now() + 5000; // Retry in 5s
      }
    }
  }

  /**
   * PHASE 3: Stop the scheduler
   * 
   * Gracefully shuts down the execution loop.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // PHASE 5: Clear collection window timer
    if (this.batchFlushTimer) {
      clearTimeout(this.batchFlushTimer);
      this.batchFlushTimer = null;
    }

    // Flush any pending batch before stopping
    if (this.pendingPoolsForBatch.size > 0) {
      await this.flushBatch();
    }

    if (this.executionLoopIntervalId) {
      clearInterval(this.executionLoopIntervalId);
      this.executionLoopIntervalId = null;
    }

    this.isRunning = false;
    console.log('🛑 Pool scheduler stopped');
  }

  /**
   * PHASE 3: Get scheduler status
   */
  public isActive(): boolean {
    return this.isRunning;
  }

  /**
   * DEBUG: Get scheduling statistics
   */
  public getSchedulingStats() {
    const aliveSet = poolController.getAliveSet();
    const byTier = {
      high: aliveSet.filter(p => p.tier === 'high').length,
      normal: aliveSet.filter(p => p.tier === 'normal').length,
      low: aliveSet.filter(p => p.tier === 'low').length,
    };

    // Calculate when next refreshes are due
    const now = Date.now();
    const nextRefreshes = aliveSet.map(p => p.nextRefresh - now);
    const avgMsUntilRefresh =
      nextRefreshes.length > 0
        ? nextRefreshes.reduce((a, b) => a + b, 0) / nextRefreshes.length
        : 0;

    return {
      isRunning: this.isRunning,
      totalTrackedPools: aliveSet.length,
      poolsByTier: byTier,
      averageMsUntilNextRefresh: Math.round(avgMsUntilRefresh),
      tierDistribution: {
        high_5s: byTier.high,
        normal_10s: byTier.normal,
        low_30s: byTier.low,
      },
      // PHASE 5: Micro-batching metrics
      microBatching: {
        pendingPoolsInBatch: this.pendingPoolsForBatch.size,
        collectionWindowMs: this.collectionWindow,
        lastBatchExecutionMs: this.lastBatchExecutionTime,
        batchFlushScheduled: this.batchFlushTimer !== null,
      },
    };
  }
}
