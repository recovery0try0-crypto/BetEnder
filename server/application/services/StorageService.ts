import fs from 'fs/promises';
import path from 'path';
import { getAddress } from 'ethers';
import { Token, Pool } from '../../domain/entities';
import { PoolRegistry, QuarantineRegistry } from '../../domain/types';

/**
 * Normalize an address to valid EIP-55 checksum format
 * Returns lowercase if checksum validation fails
 */
function normalizeAddress(address: string): string {
  try {
    return getAddress(address);
  } catch {
    // If checksum validation fails, return lowercase
    return address.toLowerCase();
  }
}

// Resolve data directory - use process.cwd() for better compatibility
const DATA_DIR = path.join(process.cwd(), 'server', 'data');

export class StorageService {
  async read(fileName: string): Promise<any> {
    try {
      const filePath = path.join(DATA_DIR, fileName);
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, return default value for the specific file
        if (fileName.startsWith('pools_') || fileName.startsWith('pool-registry_')) {
          return {};
        } else if (fileName === 'tokens.json' || fileName.startsWith('tokens_')) {
          return [];
        }
      }
      throw error;
    }
  }

  async write(fileName: string, data: any): Promise<void> {
    const filePath = path.join(DATA_DIR, fileName);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Get tokens for a specific network
   * @param chainId Network chain ID (1 = Ethereum, 137 = Polygon)
   * @returns Array of tokens for the network (with normalized addresses)
   */
  async getTokensByNetwork(chainId: number): Promise<Token[]> {
    const fileName = `tokens_${chainId === 1 ? 'ethereum' : 'polygon'}.json`;
    const tokens = await this.read(fileName) as Token[];
    // Normalize addresses to valid checksums
    return tokens.map(token => ({
      ...token,
      address: normalizeAddress(token.address)
    }));
  }

  /**
   * @deprecated Use getTokensByNetwork instead
   */
  async getTokens(): Promise<Token[]> {
    return await this.read('tokens.json') as Token[];
  }

  async savePools(pools: Pool[], chainId: number): Promise<void> {
    const fileName = `pools_${chainId === 1 ? 'ethereum' : 'polygon'}.json`;
    const existingPools = await this.read(fileName);

    pools.forEach(pool => {
      const poolKey = `${pool.token0.address}_${pool.token1.address}`;
      existingPools[poolKey] = pool.address;
    });

    await this.write(fileName, existingPools);
  }

  /**
   * PHASE 1: Get pool registry for a specific network
   * 
   * Pool registry contains:
   * - Pool metadata indexed by address (dexType, feeTier, weight)
   * - Pricing routes indexed by token address (deterministic paths)
   * 
   * @param chainId Network chain ID
   * @returns Pool registry with empty defaults if not found
   */
  async getPoolRegistry(chainId: number): Promise<PoolRegistry> {
    const fileName = `pool-registry_${chainId === 1 ? 'ethereum' : 'polygon'}.json`;
    const data = await this.read(fileName);
    
    // Ensure structure exists
    if (!data.pools) data.pools = {};
    if (!data.pricingRoutes) data.pricingRoutes = {};
    
    return data as PoolRegistry;
  }

  /**
   * PHASE 1: Save pool registry for a specific network
   * 
   * @param chainId Network chain ID
   * @param registry Updated pool registry
   */
  async savePoolRegistry(chainId: number, registry: PoolRegistry): Promise<void> {
    const fileName = `pool-registry_${chainId === 1 ? 'ethereum' : 'polygon'}.json`;
    await this.write(fileName, registry);
  }

  /**
   * PHASE 7: Get quarantine registry for a specific network
   * 
   * Quarantine registry contains newly discovered tokens awaiting validation.
   * These tokens have not yet been confirmed to have sufficient liquidity/pools.
   * 
   * @param chainId Network chain ID
   * @returns Quarantine registry with empty defaults if not found
   */
  async getQuarantineRegistry(chainId: number): Promise<QuarantineRegistry> {
    const fileName = `quarantine-registry_${chainId === 1 ? 'ethereum' : 'polygon'}.json`;
    const data = await this.read(fileName);
    
    // Ensure structure exists
    if (!data.entries) data.entries = {};
    
    return data as QuarantineRegistry;
  }

  /**
   * PHASE 7: Save quarantine registry for a specific network
   * 
   * @param chainId Network chain ID
   * @param registry Updated quarantine registry
   */
  async saveQuarantineRegistry(chainId: number, registry: QuarantineRegistry): Promise<void> {
    const fileName = `quarantine-registry_${chainId === 1 ? 'ethereum' : 'polygon'}.json`;
    await this.write(fileName, registry);
  }

  /**
   * PHASE 7: Promote a quarantined token to primary registry
   * 
   * Called when a quarantined token passes validation.
   * Moves token from quarantine to primary registry.
   * Invalidates CacheLayer so fresh data is served on next request.
   * 
   * @param chainId Network chain ID
   * @param tokenAddress Token address to promote
   * @param cacheLayer Optional CacheLayer to invalidate after promotion
   */
  async promoteQuarantineToken(chainId: number, tokenAddress: string, cacheLayer?: any): Promise<void> {
    const quarantine = await this.getQuarantineRegistry(chainId);
    const entry = quarantine.entries[tokenAddress];
    
    if (!entry) {
      console.warn(`⚠️ Cannot promote token ${tokenAddress} - not found in quarantine`);
      return;
    }
    
    // Add to primary token registry
    const tokens = await this.getTokensByNetwork(chainId);
    
    // Check if already exists in primary
    if (!tokens.some(t => t.address === tokenAddress)) {
      tokens.push({
        address: tokenAddress,
        ...entry.metadata,
        chainId: chainId,
        logoURI: entry.metadata.logoURI || '', // Preserve logo from metadata
      });
    }
    
    // Mark as promoted in quarantine
    entry.promoted = true;
    
    // Persist both registries
    await this.write(`tokens_${chainId === 1 ? 'ethereum' : 'polygon'}.json`, tokens);
    await this.saveQuarantineRegistry(chainId, quarantine);
    
    console.log(`✅ PHASE 7: Token ${tokenAddress.slice(0, 6)}... promoted from quarantine to primary`);
    
    // CACHE INVALIDATION: Refresh cached token list for next request
    // This ensures the newly promoted token is included in searches and overviews
    if (cacheLayer) {
      cacheLayer.invalidateTokenCache(chainId);
      console.log(`  🔄 Invalidated token cache for chain ${chainId} - newly promoted token will be served on next request`);
    }
  }

  /**
   * PHASE 7: Remove a token from quarantine (purge failed validations)
   * 
   * Called by garbage collection when unvalidated tokens exceed TTL.
   * 
   * @param chainId Network chain ID
   * @param tokenAddress Token address to remove
   */
  async removeFromQuarantine(chainId: number, tokenAddress: string): Promise<void> {
    const quarantine = await this.getQuarantineRegistry(chainId);
    
    if (quarantine.entries[tokenAddress]) {
      delete quarantine.entries[tokenAddress];
      await this.saveQuarantineRegistry(chainId, quarantine);
      console.log(`🗑️ PHASE 7: Token ${tokenAddress.slice(0, 6)}... removed from quarantine (failed validation)`);
    }
  }
}

export const storageService = new StorageService();
