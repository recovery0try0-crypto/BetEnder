import { StorageService } from './StorageService';
import { TokenDiscoveryManager } from './TokenDiscoveryManager';
import { EthersAdapter } from '../../infrastructure/adapters/EthersAdapter';
import { CacheLayer } from './CacheLayer';
import { timingConfig } from '../../infrastructure/config/TimingConfig';

/**
 * PHASE 7: Quarantine Validator
 * 
 * Background service that validates newly discovered tokens.
 * 
 * Validation checks:
 * 1. Pool existence - token must appear in at least one pool
 * 2. Liquidity threshold - pool must meet minimum liquidity requirement
 * 
 * Promotes qualified tokens from quarantine to primary registry.
 * Automatically purges unvalidated tokens after 7 days (handled by Phase 8 GC).
 * 
 * Runs as background task - does NOT block user interactions.
 * RPC calls allowed here (background validator, not user-triggered).
 */
class QuarantineValidator {
  private validationLoops: Map<number, NodeJS.Timeout> = new Map();
  private readonly VALIDATION_INTERVAL_MS = timingConfig.QUARANTINE_VALIDATION_INTERVAL_MS;
  private readonly MIN_LIQUIDITY = timingConfig.QUARANTINE_MIN_LIQUIDITY;

  constructor(
    private storageService: StorageService,
    private ethersAdapter: EthersAdapter,
    private tokenDiscoveryManager: TokenDiscoveryManager,
    private cacheLayer?: CacheLayer
  ) {}

  /**
   * Check if a quarantined token is valid and promote if so.
   * 
   * Validation process:
   * 1. Find pools containing this token
   * 2. Check if liquidity meets threshold
   * 3. If valid: promote to primary registry
   * 
   * @param chainId Network chain ID
   * @param tokenAddress Token address to validate
   * @returns true if token is valid and promoted, false otherwise
   */
  async validateToken(chainId: number, tokenAddress: string): Promise<boolean> {
    try {
      const quarantine = await this.storageService.getQuarantineRegistry(chainId);
      const entry: any = quarantine.entries[tokenAddress.toLowerCase()];

      if (!entry) {
        return false; // Token not in quarantine
      }

      if (entry.promoted) {
        return true; // Already promoted
      }

      console.log(`🔍 PHASE 7: Validating quarantined token ${tokenAddress.slice(0, 6)}...`);

      // STEP 1: Ensure topology exists for this token
      // If not discovered yet, trigger discovery now
      const poolRegistry = await this.storageService.getPoolRegistry(chainId);
      const existingPools = Object.values(poolRegistry.pools || {}).filter(
        (pool: any) => pool.token0?.toLowerCase() === tokenAddress.toLowerCase() || pool.token1?.toLowerCase() === tokenAddress.toLowerCase()
      );

      if (existingPools.length === 0) {
        console.log(`  ⏳ No pools found - triggering discovery for ${tokenAddress.slice(0, 6)}...`);
        
        // Trigger discovery for this single token
        const discovered = await this.tokenDiscoveryManager.discoverPoolsForTokens(
          [
            {
              address: tokenAddress,
              symbol: entry.metadata?.symbol || 'UNKNOWN',
              name: entry.metadata?.name || 'Unknown Token',
              decimals: entry.metadata?.decimals || 18,
              chainId,
              logoURI: '',
            }
          ],
          chainId
        );

        if (discovered === 0) {
          console.log(`  ❌ Discovery found no pools for token ${tokenAddress.slice(0, 6)}... - not eligible`);
          return false; // Discovery found nothing
        }

        console.log(`  ✓ Discovery found ${discovered} pool(s) for token`);
      } else {
        console.log(`  ✓ Found ${existingPools.length} pool(s) for token (already discovered)`);
      }

      // STEP 2: Recheck pools after potential discovery
      const updatedRegistry = await this.storageService.getPoolRegistry(chainId);
      const validPools = Object.values(updatedRegistry.pools || {}).filter(
        (pool: any) => pool.token0?.toLowerCase() === tokenAddress.toLowerCase() || pool.token1?.toLowerCase() === tokenAddress.toLowerCase()
      );

      if (validPools.length === 0) {
        console.log(`  ❌ Still no pools after discovery - validation failed`);
        return false;
      }

      const primaryPool: any = validPools[0];

      console.log(`  ✓ Liquidity check: ${primaryPool.address.slice(0, 6)}...`);

      // STEP 3: Promote to primary registry with cache invalidation
      await this.storageService.promoteQuarantineToken(chainId, tokenAddress, this.cacheLayer);
      entry.promoted = true;

      console.log(`  ✅ Token ${tokenAddress.slice(0, 6)}... validated and promoted`);
      return true;
    } catch (error) {
      console.error(`❌ Validation error for token ${tokenAddress}:`, error);
      return false;
    }
  }

  /**
   * Validate all tokens in quarantine registry for a network.
   * 
   * Called periodically (every 10 minutes).
   * Processes all unvalidated entries in quarantine.
   * 
   * @param chainId Network chain ID
   */
  async validateAllQuarantined(chainId: number): Promise<void> {
    try {
      const quarantine = await this.storageService.getQuarantineRegistry(chainId);
      const entries = Object.entries(quarantine.entries);

      if (entries.length === 0) {
        return; // Nothing to validate
      }

      console.log(
        `🔄 PHASE 7: Starting quarantine validation for ${entries.length} token(s)`
      );

      // FIX #2: Validate all tokens in parallel instead of sequentially
      const unvalidatedEntries = entries.filter(([_, entry]) => !(entry as any).promoted);
      
      const validationResults = await Promise.all(
        unvalidatedEntries.map(([tokenAddress]) => 
          this.validateToken(chainId, tokenAddress).catch(err => {
            console.error(`Error validating ${tokenAddress}:`, err);
            return false;
          })
        )
      );

      let validated = 0;
      let failed = 0;

      for (const valid of validationResults) {
        if (valid) {
          validated++;
        } else {
          failed++;
        }
      }

      console.log(
        `📊 PHASE 7: Validation complete: ${validated} promoted, ${failed} unvalidated`
      );
    } catch (error) {
      console.error('❌ Quarantine validation failed:', error);
    }
  }

  /**
   * Start periodic validation loop for a network.
   * 
   * Validates all quarantined tokens every 10 minutes.
   * Does NOT block other operations.
   * 
   * @param chainId Network chain ID
   */
  startValidationLoop(chainId: number): void {
    if (this.validationLoops.has(chainId)) {
      console.warn(`⚠️ Validation loop already running for chain ${chainId}`);
      return;
    }

    console.log(`▶️ PHASE 7: Starting quarantine validation loop for chain ${chainId}`);

    // Run first validation immediately
    this.validateAllQuarantined(chainId).catch(error =>
      console.error(`First quarantine validation failed:`, error)
    );

    // Schedule periodic validations
    const intervalId = setInterval(
      () => this.validateAllQuarantined(chainId),
      this.VALIDATION_INTERVAL_MS
    );

    this.validationLoops.set(chainId, intervalId);
  }

  /**
   * Stop validation loop for a network.
   * 
   * @param chainId Network chain ID
   */
  stopValidationLoop(chainId: number): void {
    const intervalId = this.validationLoops.get(chainId);
    if (intervalId) {
      clearInterval(intervalId);
      this.validationLoops.delete(chainId);
      console.log(`⏹️ PHASE 7: Stopped validation loop for chain ${chainId}`);
    }
  }

  /**
   * Stop all validation loops.
   * 
   * Called on server shutdown.
   */
  stopAllLoops(): void {
    for (const [chainId, intervalId] of this.validationLoops.entries()) {
      clearInterval(intervalId);
      console.log(`⏹️ Stopped validation loop for chain ${chainId}`);
    }
    this.validationLoops.clear();
  }
}

export { QuarantineValidator };
