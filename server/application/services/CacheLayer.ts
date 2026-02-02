/**
 * CacheLayer - In-Memory Token & Registry Caching
 * 
 * RESPONSIBILITY:
 * - Maintain in-memory copies of token lists and pool registries
 * - Eliminate repeated disk reads for frequently accessed data
 * - Invalidate only on topology changes (rare events)
 * - Provide fast lookups for pagination and search
 * 
 * INVALIDATION TRIGGERS:
 * - Topology changes: New pools discovered (TokenDiscoveryManager)
 * - TTL refresh: Token topology expires and is re-queried
 */

import { StorageService } from './StorageService';
import { Token } from '../../domain/entities';
import { PoolRegistry } from '../../domain/types';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export class CacheLayer {
  private tokenCache: Map<number, CacheEntry<Token[]>> = new Map();
  private registryCache: Map<number, CacheEntry<PoolRegistry>> = new Map();

  constructor(private storageService: StorageService) {}

  /**
   * Get tokens for a network from cache
   * Falls through to storage if not cached or stale
   * 
   * @param chainId Network chain ID
   * @returns Cached or freshly loaded tokens
   */
  public async getTokensByNetworkCached(chainId: number): Promise<Token[]> {
    // Check cache
    const cached = this.tokenCache.get(chainId);
    if (cached) {
      return cached.data;
    }

    // Cache miss - load from storage
    console.log(`📦 [CACHE] Token cache miss for chain ${chainId}, loading from storage`);
    const tokens = await this.storageService.getTokensByNetwork(chainId);
    
    // Store in cache
    this.tokenCache.set(chainId, {
      data: tokens,
      timestamp: Date.now(),
    });

    console.log(`✓ [CACHE] Loaded ${tokens.length} tokens for chain ${chainId}`);
    return tokens;
  }

  /**
   * Get pool registry for a network from cache
   * Falls through to storage if not cached
   * 
   * @param chainId Network chain ID
   * @returns Cached or freshly loaded pool registry
   */
  public async getPoolRegistryCached(chainId: number): Promise<PoolRegistry> {
    // Check cache
    const cached = this.registryCache.get(chainId);
    if (cached) {
      return cached.data;
    }

    // Cache miss - load from storage
    console.log(`📦 [CACHE] Registry cache miss for chain ${chainId}, loading from storage`);
    const registry = await this.storageService.getPoolRegistry(chainId);

    // Store in cache
    this.registryCache.set(chainId, {
      data: registry,
      timestamp: Date.now(),
    });

    console.log(`✓ [CACHE] Loaded pool registry for chain ${chainId}`);
    return registry;
  }

  /**
   * Invalidate token cache for a chain
   * Called when topology changes or TTL expires
   * 
   * @param chainId Network chain ID
   */
  public invalidateTokenCache(chainId: number): void {
    this.tokenCache.delete(chainId);
    console.log(`🔄 [CACHE] Invalidated token cache for chain ${chainId}`);
  }

  /**
   * Invalidate registry cache for a chain
   * Called when new pools are discovered or topology is refreshed
   * 
   * @param chainId Network chain ID
   */
  public invalidateRegistryCache(chainId: number): void {
    this.registryCache.delete(chainId);
    console.log(`🔄 [CACHE] Invalidated registry cache for chain ${chainId}`);
  }

  /**
   * Invalidate all caches
   * For testing or manual reset
   */
  public clearAllCaches(): void {
    this.tokenCache.clear();
    this.registryCache.clear();
    console.log(`🗑️ [CACHE] Cleared all caches`);
  }

  /**
   * Get cache statistics for monitoring
   */
  public getStats() {
    return {
      tokenCacheEntries: this.tokenCache.size,
      registryCacheEntries: this.registryCache.size,
      totalChainsCached: new Set([
        ...this.tokenCache.keys(),
        ...this.registryCache.keys(),
      ]).size,
    };
  }
}
