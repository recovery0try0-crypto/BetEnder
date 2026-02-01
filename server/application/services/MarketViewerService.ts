/**
 * MarketViewerService - Market Data Display Service
 * 
 * RESPONSIBILITY: Fetch and aggregate market data for tokens
 * - Token prices in USD via SpotPricingEngine (uses pool data)
 * - Token metadata from StorageService
 * - Liquidity, holders from Explorer APIs (optional)
 * - Track data sources explicitly
 * - Support network-specific data
 * 
 * PRICING FLOW:
 * 1. SpotPricingEngine computes prices from pool data (cached in SharedStateCache)
 * 2. Pool data is maintained fresh by PoolScheduler
 * 3. Explorer APIs provide supplemental metadata (holders, contract creation date)
 * 
 * HOT PATH INTEGRATION:
 * - Receives tokens with pricingPools already attached (from cold path)
 * - Calls PoolController.handleTokenInterest() to register pool interest
 * - PoolScheduler monitors and executes multicall queries
 * 
 * EXPLICIT DATA TRACKING:
 * Every response includes "dataSource" field showing where data came from
 */

import { StorageService } from './StorageService';
import { spotPricingEngine } from './SpotPricingEngine';
import { sharedStateCache } from './SharedStateCache';
import { poolController } from './PoolController';
import { PoolScheduler } from './PoolScheduler';
import { EthersAdapter } from '../../infrastructure/adapters/EthersAdapter';
import { providersConfig } from '../../infrastructure/config/ProvidersConfig';
import {
  TokenMarketData,
  MarketOverview,
  DataSource,
  TokenSearchResult,
  FetchMarketDataOptions,
} from '../../domain/market-viewer.types';

class MarketViewerService {
  private storageService: StorageService;
  private cache: Map<string, { data: TokenMarketData; expireAt: number }> = new Map();
  private readonly DEFAULT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private poolScheduler: PoolScheduler | null = null;
  private schedulerStarted = false;

  constructor(storageService: StorageService) {
    this.storageService = storageService;
    this.initializeScheduler();
  }

  /**
   * Initialize PoolScheduler (hot path executor)
   */
  private initializeScheduler(): void {
    try {
      // Get RPC providers from config
      const rpcProviders: { [chainId: number]: string } = {};
      try {
        rpcProviders[1] = providersConfig.getRpcProvider(1);
      } catch {
        rpcProviders[1] = process.env.ETHEREUM_PUBLIC_RPC || 'https://cloudflare-eth.com';
      }
      try {
        rpcProviders[137] = providersConfig.getRpcProvider(137);
      } catch {
        rpcProviders[137] = process.env.POLYGON_PUBLIC_RPC || 'https://polygon-rpc.com';
      }

      const ethersAdapter = new EthersAdapter(rpcProviders);
      this.poolScheduler = new PoolScheduler(this.storageService, ethersAdapter, 1);
    } catch (error) {
      console.error('Failed to initialize PoolScheduler:', error);
    }
  }

  /**
   * Start the pool scheduler if not already running
   */
  private async startSchedulerIfNeeded(): Promise<void> {
    if (this.schedulerStarted || !this.poolScheduler) return;

    try {
      await this.poolScheduler.start();
      this.schedulerStarted = true;
      console.log('✓ Pool scheduler started by MarketViewerService');
    } catch (error) {
      console.error('Error starting pool scheduler:', error);
    }
  }

  /**
   * Get market data for a single token
   * 
   * PRICING: Uses SpotPricingEngine to compute price from pool data
   * METADATA: Fetched from storage service
   * 
   * @param tokenAddress Token contract address
   * @param chainId Network chain ID
   * @param options Fetch options
   * @returns Token market data with source attribution
   */
  public async getTokenMarketData(
    tokenAddress: string,
    chainId: number,
    options?: FetchMarketDataOptions
  ): Promise<TokenMarketData> {
    const cacheKey = `${tokenAddress}-${chainId}`;

    // Check cache first (unless forceRefresh)
    if (!options?.forceRefresh) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expireAt > Date.now()) {
        console.log(`✓ Market data from cache: ${tokenAddress} on chain ${chainId}`);
        return cached.data;
      }
    }

    // Get token metadata from storage
    const tokens = await this.storageService.getTokensByNetwork(chainId);
    const token = tokens.find(t => t.address.toLowerCase() === tokenAddress.toLowerCase());

    if (!token) {
      throw new Error(`Token ${tokenAddress} not found on chain ${chainId}`);
    }

    // Compute price using SpotPricingEngine (uses pool data from SharedStateCache)
    const price = await spotPricingEngine.computeSpotPrice(tokenAddress, chainId);

    // Build market data response
    const hasValidPrice = price !== null && price > 0;
    const marketData: TokenMarketData = {
      address: tokenAddress,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      chainId,
      price: price || 0,
      priceChange24h: 0, // Not tracked currently
      liquidity: 0, // Not tracked currently
      volume24h: 0, // Not tracked currently
      holders: 0, // Would come from explorer API if implemented
      dataSource: hasValidPrice ? 'multicall' : 'insufficient-data' as DataSource,
      timestamp: Date.now(),
      cachedUntil: Date.now() + (hasValidPrice ? this.DEFAULT_CACHE_TTL : 0), // Disable caching for insufficient data
    };

    // Only cache data with valid prices to allow refresh when pool states become available
    if (hasValidPrice) {
      this.setCacheEntry(cacheKey, marketData);
    }
    return marketData;
  }

  /**
   * Get market overview for all tokens on a network
   * 
   * HOT PATH: Called when UI requests token prices.
   * 1. Notifies PoolController of token interest (maps to pools)
   * 2. Starts PoolScheduler if needed
   * 3. Fetches pricing data for each token
   * 
   * @param chainId Network chain ID
   * @param tokensWithPools Tokens with pricingPools already attached
   * @returns Market overview with all tokens
   */
  public async getMarketOverview(chainId: number, tokensWithPools?: any[]): Promise<MarketOverview> {
    console.log(`📊 Fetching market overview for chain ${chainId}`);

    // If tokens not provided, get from storage and attach pools
    let tokens = tokensWithPools;
    if (!tokens) {
      const tokensFromStorage = await this.storageService.getTokensByNetwork(chainId);
      const poolRegistry = await this.storageService.getPoolRegistry(chainId);
      tokens = tokensFromStorage.map(token => ({
        ...token,
        pricingPools: poolRegistry.pricingRoutes[token.address.toLowerCase()] || [],
      }));
    }

    // HOT PATH INTEGRATION:
    // 1. Notify PoolController of token interest (deduplicates to pools)
    poolController.handleTokenInterest(tokens, chainId);
    
    // 2. Start scheduler if needed
    await this.startSchedulerIfNeeded();

    // Fetch market data for each token in parallel with error handling
    const marketDataPromises = tokens.map(token =>
      this.getTokenMarketData(token.address, chainId).catch(error => {
        console.error(`Error fetching market data for ${token.symbol}:`, error.message);
        // Return token with insufficient data on error
        return {
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
          chainId,
          price: 0,
          priceChange24h: 0,
          liquidity: 0,
          volume24h: 0,
          holders: 0,
          dataSource: 'insufficient-data' as const,
          timestamp: Date.now(),
          cachedUntil: Date.now(), // Disable caching for failed tokens
        };
      })
    );

    const marketDataResults = await Promise.all(marketDataPromises);

    // Calculate aggregate metrics
    const totalLiquidity = marketDataResults.reduce((sum: number, t: TokenMarketData) => sum + (t.liquidity || 0), 0);
    const totalVolume24h = marketDataResults.reduce((sum: number, t: TokenMarketData) => sum + (t.volume24h || 0), 0);

    return {
      chainId,
      tokens: marketDataResults,
      timestamp: Date.now(),
      totalLiquidity,
      totalVolume24h,
    };
  }

  /**
   * Search for tokens by symbol, name, or address
   * 
   * @param query Search query
   * @param chainId Network chain ID
   * @returns Array of matching tokens
   */
  public async searchTokens(query: string, chainId: number): Promise<TokenSearchResult[]> {
    console.log(`🔍 Searching tokens for: "${query}" on chain ${chainId}`);

    const tokens = await this.storageService.getTokensByNetwork(chainId);
    const lowerQuery = query.toLowerCase();

    const results: TokenSearchResult[] = tokens
      .map(token => {
        let relevanceScore = 0;

        // Exact symbol match = high score
        if (token.symbol.toLowerCase() === lowerQuery) {
          relevanceScore = 1.0;
        }
        // Symbol starts with query = high score
        else if (token.symbol.toLowerCase().startsWith(lowerQuery)) {
          relevanceScore = 0.9;
        }
        // Name contains query = medium score
        else if (token.name.toLowerCase().includes(lowerQuery)) {
          relevanceScore = 0.6;
        }
        // Address match = low score
        else if (token.address.toLowerCase().includes(lowerQuery)) {
          relevanceScore = 0.3;
        }

        return {
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          chainId,
          logoURI: (token as any).logoURI,
          relevanceScore,
        };
      })
      .filter(t => t.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    return results;
  }

  /**
   * Get tokens for a specific network
   * 
   * PHASE 1: Attach pool metadata before serving to hot path
   * 
   * @param chainId Network chain ID
   * @returns List of tokens with attached pool metadata
   */
  public async getTokensForNetwork(chainId: number) {
    console.log(`📋 Fetching tokens for chain ${chainId}`);
    const tokens = await this.storageService.getTokensByNetwork(chainId);
    
    // PHASE 1: Attach pool metadata to each token
    const poolRegistry = await this.storageService.getPoolRegistry(chainId);
    const tokensWithPools = tokens.map(token => ({
      ...token,
      pricingPools: poolRegistry.pricingRoutes[token.address] || [],
    }));

    return tokensWithPools;
  }

  /**
   * INTERNAL: Get fallback data (no mock random numbers)
   * DATA SOURCE: On-chain data (where available)
   */
  private getMockTokenData(tokenAddress: string, chainId: number): TokenMarketData {
    // Return realistic fallback: fetch what we can from storage/explorer,
    // but DO NOT generate random numbers
    const token = {
      address: tokenAddress,
      symbol: 'N/A',
      name: `Token ${tokenAddress.slice(2, 8)}`,
      decimals: 18,
      chainId,
      price: 0, // No pricing data available
      priceChange24h: 0,
      liquidity: 0, // No liquidity data available
      volume24h: 0, // No volume data available
      holders: 0,
      dataSource: 'insufficient-data' as DataSource,
      timestamp: Date.now(),
      cachedUntil: Date.now() + this.DEFAULT_CACHE_TTL,
    };

    console.warn(`⚠️ Insufficient data for token ${tokenAddress} - returning zero values`);
    return token;
  }

  /**
   * INTERNAL: Store data in cache
   */
  private setCacheEntry(key: string, data: TokenMarketData): void {
    this.cache.set(key, {
      data,
      expireAt: Date.now() + this.DEFAULT_CACHE_TTL,
    });
  }

  /**
   * Clear cache (for testing or manual refresh)
   */
  public clearCache(): void {
    this.cache.clear();
    console.log('🗑️ Market viewer cache cleared');
  }

  /**
   * Get cache status
   */
  public getCacheStatus() {
    return {
      entriesCount: this.cache.size,
      ttl: this.DEFAULT_CACHE_TTL,
    };
  }
}

// Export singleton
let instance: MarketViewerService;

export function createMarketViewerService(storageService: StorageService): MarketViewerService {
  if (!instance) {
    instance = new MarketViewerService(storageService);
  }
  return instance;
}

export { MarketViewerService };
