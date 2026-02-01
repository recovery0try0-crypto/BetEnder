
import { sharedStateCache } from './SharedStateCache';
import { storageService } from './StorageService';

// Known USD stablecoins for price anchoring
const USD_STABLECOINS: Record<number, Set<string>> = {
  1: new Set([
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
    '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
    '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
  ]),
  137: new Set([
    '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC
    '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', // USDT
    '0x8f3cf7ad23cd3cadbd9735aff958023d60d76ee6', // DAI
  ]),
};

// Token decimals lookup
const TOKEN_DECIMALS: Record<string, number> = {
  // Ethereum
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6,  // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 6,  // USDT
  '0x6b175474e89094c44da98b954eedeac495271d0f': 18, // DAI
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 18, // WETH
  '0x2260fac5e5542a773aa44fbcfedd86a9abde89b6': 8,  // WBTC
  // Polygon
  '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 6,  // USDC
  '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 6,  // USDT
  '0x8f3cf7ad23cd3cadbd9735aff958023d60d76ee6': 18, // DAI
  '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': 18, // WETH
  '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': 18, // WMATIC
};

class SpotPricingEngine {
  /**
   * Get token decimals from cache or hardcoded lookup
   */
  private getDecimals(tokenAddress: string): number {
    const normalized = tokenAddress.toLowerCase();
    // Check hardcoded lookup first
    if (TOKEN_DECIMALS[normalized] !== undefined) {
      return TOKEN_DECIMALS[normalized];
    }
    // Try to get from cache
    const metadata = sharedStateCache.getTokenMetadata(tokenAddress);
    return metadata?.decimals ?? 18;
  }

  /**
   * Check if token is a USD stablecoin
   */
  private isUsdStablecoin(tokenAddress: string, chainId: number): boolean {
    return USD_STABLECOINS[chainId]?.has(tokenAddress.toLowerCase()) ?? false;
  }

  /**
   * Calculates the spot price of a token in USD.
   * Uses pre-indexed pricing routes from pool registry (cold path output).
   * Fetches pool states from cache (hot path).
   * 
   * @param tokenAddress The address of the token to price.
   * @param chainId The chain ID of the token.
   * @returns The spot price in USD, or null if it cannot be calculated.
   */
  public async computeSpotPrice(tokenAddress: string, chainId: number): Promise<number | null> {
    const normalizedToken = tokenAddress.toLowerCase();

    // If it's a stablecoin, return $1
    if (this.isUsdStablecoin(normalizedToken, chainId)) {
      return 1.0;
    }

    // Get pricing route from pool registry (pre-indexed by cold path)
    const poolRegistry = await storageService.getPoolRegistry(chainId);
    const routes = poolRegistry.pricingRoutes[normalizedToken];

    if (!routes || routes.length === 0) {
      console.log(`  💰 No pricing routes for ${tokenAddress.slice(0,10)}... on chain ${chainId}`);
      return null; // No pricing route for this token
    }

    // Find a route to a USD stablecoin with cached pool state
    let bestRoute = null;
    for (const route of routes) {
      const poolState = sharedStateCache.getPoolState(route.pool);
      if (poolState && this.isUsdStablecoin(route.base, chainId)) {
        bestRoute = route;
        break; // Found a stablecoin route with cached pool
      }
    }

    // If no stablecoin route with cache, try any route with cache
    if (!bestRoute) {
      for (const route of routes) {
        const poolState = sharedStateCache.getPoolState(route.pool);
        if (poolState) {
          bestRoute = route;
          break;
        }
      }
    }

    if (!bestRoute) {
      // Don't log if it's a known frequent failure to avoid log noise
      // console.log(`  💰 No cached pool state for ${tokenAddress.slice(0,10)}... on chain ${chainId}`);
      return null;
    }

    const poolAddress = bestRoute.pool;

    // Get pool state from cache (populated by hot path via discovery/multicall)
    const poolState = sharedStateCache.getPoolState(poolAddress);
    if (!poolState) {
      return null;
    }

    // Calculate price from sqrtPriceX96
    // sqrtPriceX96 = sqrt(price) * 2^96 where price = token1/token0 in raw units
    // price = (sqrtPriceX96 / 2^96)^2
    const sqrtPrice = Number(poolState.sqrtPriceX96) / (2 ** 96);
    let rawPrice = sqrtPrice * sqrtPrice;

    // Determine if our token is token0 or token1
    const isToken0 = poolState.token0.toLowerCase() === normalizedToken;
    
    // Get decimals for adjustment
    const token0Decimals = this.getDecimals(poolState.token0);
    const token1Decimals = this.getDecimals(poolState.token1);

    // Adjust for decimals: rawPrice is token1/token0 in raw units
    // To get real units: price = rawPrice * 10^(token0Decimals - token1Decimals)
    const decimalAdjustment = Math.pow(10, token0Decimals - token1Decimals);
    rawPrice = rawPrice * decimalAdjustment;
    // Now rawPrice = (token1 amount) / (token0 amount) in real units

    // We want: price of our token in base token units
    // rawPrice gives us token1/token0
    // If our token is token0: base is token1, we want base/ourToken = token1/token0 = rawPrice
    // If our token is token1: base is token0, we want base/ourToken = token0/token1 = 1/rawPrice
    let priceInBaseToken = isToken0 ? rawPrice : (rawPrice > 0 ? 1 / rawPrice : 0);

    // If the base token is a USD stablecoin, this is the USD price
    if (this.isUsdStablecoin(bestRoute.base, chainId)) {
      return priceInBaseToken;
    }

    // Otherwise, we need to get the USD price of the base token (recursive)
    const baseUsdPrice = await this.computeSpotPrice(bestRoute.base, chainId);
    if (baseUsdPrice === null) {
      return null;
    }

    return priceInBaseToken * baseUsdPrice;
  }
}

export const spotPricingEngine = new SpotPricingEngine();
