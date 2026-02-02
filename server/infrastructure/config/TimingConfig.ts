/**
 * TimingConfig - Centralized configuration for all timing constants
 * 
 * All time-based constants used throughout the application are defined here.
 * This makes it easy to tune performance without diving into service code.
 * 
 * TIMING HIERARCHY:
 * - Stay-alive protocol: 30s (client-side, user watching)
 * - Pool refresh: 1s (main loop check), 5-30s per pool (tiered)
 * - Micro-batching: 75ms collection window
 * - GC cleanup: Various intervals (10s state, 30s pools, 1h logos)
 * - Discovery retry: 5 minutes between discovery attempts
 * - Topology TTL: 7 days before refresh
 */

export const timingConfig = {
  // === API & Pagination ===
  TOKENS_PER_PAGE: 15,

  // === Cache TTLs ===
  MARKET_DATA_CACHE_TTL_MS: 5 * 60 * 1000, // 5 minutes
  STATE_CACHE_TTL_MS: 30 * 1000, // 30 seconds
  LOGO_CACHE_TTL_MS: 30 * 24 * 60 * 60 * 1000, // 30 days
  QUARANTINE_TTL_MS: 7 * 24 * 60 * 60 * 1000, // 7 days

  // === Pool Lifecycle ===
  POOL_GRACE_PERIOD_MS: 20 * 1000, // 20 seconds before removal after refCount=0
  TOPOLOGY_TTL_MS: 7 * 24 * 60 * 60 * 1000, // 7 days before topology refresh

  // === Micro-batching ===
  MICROBATCH_COLLECTION_WINDOW_MS: 75, // Milliseconds to collect pools before multicall

  // === Discovery ===
  DISCOVERY_RETRY_WINDOW_MS: 5 * 60 * 1000, // 5 minutes between discovery attempts for same token
  DISCOVERY_TOPOLOGY_TTL_MS: 7 * 24 * 60 * 60 * 1000, // 7 days before stale

  // === Quarantine Validation ===
  QUARANTINE_VALIDATION_INTERVAL_MS: 10 * 60 * 1000, // Every 10 minutes
  QUARANTINE_MIN_LIQUIDITY: 1000 * Math.pow(10, 18), // 1000 base units

  // === GC Cleanup Intervals ===
  STATE_CLEANUP_INTERVAL_MS: 10 * 1000, // Every 10 seconds
  POOL_CLEANUP_INTERVAL_MS: 30 * 1000, // Every 30 seconds
  LOGO_CLEANUP_INTERVAL_MS: 60 * 60 * 1000, // Every 1 hour
  QUARANTINE_CLEANUP_INTERVAL_MS: 60 * 60 * 1000, // Every 1 hour
  TOPOLOGY_REFRESH_INTERVAL_MS: 7 * 24 * 60 * 60 * 1000, // Every 7 days

  // === Discovery Thresholds ===
  LIQUIDITY_THRESHOLD: 0.9, // Keep pools contributing 90%+ of liquidity
} as const;

export type TimingConfig = typeof timingConfig;
