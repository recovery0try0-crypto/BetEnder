
import { sharedStateCache } from './SharedStateCache';

class SpotPricingEngine {
  /**
   * Calculates the spot price of a token in USD.
   * @param tokenAddress The address of the token to price.
   * @param chainId The chain ID of the token.
   * @returns The spot price in USD, or null if it cannot be calculated.
   */
  public computeSpotPrice(tokenAddress: string, chainId: number): number | null {
    // For simplicity, we'll use a hardcoded stablecoin address as the reference
    const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // Mainnet USDC

    // Find a pool that pairs the token with USDC
    // In a real implementation, we would need a more robust way to find the best pool
    const pool = this.findUsdcPool(tokenAddress, chainId);

    if (!pool) {
      return null;
    }

    const poolState = sharedStateCache.getPoolState(pool);
    if (!poolState) {
      return null;
    }

    const tokenMetadata = sharedStateCache.getTokenMetadata(tokenAddress);
    const usdcMetadata = sharedStateCache.getTokenMetadata(usdcAddress);

    if (!tokenMetadata || !usdcMetadata) {
      return null;
    }

    // The price is the ratio of the reserves, adjusted for decimals
    const price = (Number(poolState.sqrtPriceX96) / 2**96)**2 * 10**(tokenMetadata.decimals - usdcMetadata.decimals);
    return price;
  }

  public findUsdcPool(tokenAddress: string, chainId: number): string | undefined {
    // Common stablecoin addresses by chain
    const stablecoins: Record<number, string[]> = {
      1: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0x6B175474E89094C44Da98b954EedeAC495271d0F'], // USDC, DAI
      137: ['0x2791Bca1f2de4661ED88A30C99a7a9449Aa84174', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'], // USDC, USDT on Polygon
    };

    const chainStables = stablecoins[chainId] || [];
    const pools = sharedStateCache.getPoolsForToken(tokenAddress);
    
    // Find the pool with the highest liquidity that pairs this token with a stablecoin
    let bestPool: any = undefined;
    let maxLiquidity = 0n;

    for (const pool of pools) {
      const otherToken = pool.token0.toLowerCase() === tokenAddress.toLowerCase() ? pool.token1 : pool.token0;
      if (chainStables.some(stable => stable.toLowerCase() === otherToken.toLowerCase()) && pool.liquidity > maxLiquidity) {
        maxLiquidity = pool.liquidity;
        bestPool = pool;
      }
    }

    return bestPool ? bestPool.address : undefined;
  }
}

export const spotPricingEngine = new SpotPricingEngine();
