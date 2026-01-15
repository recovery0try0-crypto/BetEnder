import { IChainAdapter } from "../../infrastructure/adapters/MockAdapter";
import { ChainSnapshot, SnapshotEntry } from "../../domain/entities";
import { computeSpotPrice, computeLiquidityUSD } from "../../domain/pricing";
import { SUPPORTED_TOKENS } from "../../../shared/tokens";

export class SnapshotService {
  private adapters: Map<string, IChainAdapter>;
  private cache: Map<string, ChainSnapshot>;
  private isUpdating: Map<string, boolean>;

  constructor(adapters: IChainAdapter[]) {
    this.adapters = new Map();
    this.cache = new Map();
    this.isUpdating = new Map();
    adapters.forEach(adapter => this.adapters.set(adapter.getChainName().toLowerCase(), adapter));
  }

  async generateSnapshot(chain: string): Promise<ChainSnapshot> {
    const chainKey = chain.toLowerCase();
    const adapter = this.adapters.get(chainKey);
    if (!adapter) {
      throw new Error(`No adapter found for chain: ${chain}`);
    }

    if (this.isUpdating.get(chainKey)) {
      const cached = this.cache.get(chainKey);
      if (cached) return cached;
    }

    this.isUpdating.set(chainKey, true);

    try {
      const pools = await adapter.getTopPools(10);
      const stableAddress = adapter.getStableTokenAddress();
      const metadata = SUPPORTED_TOKENS[chainKey] || [];

      const entries: SnapshotEntry[] = pools.map(pool => {
        const isToken0Stable = pool.token0.address === stableAddress;
        const targetToken = isToken0Stable ? pool.token1 : pool.token0;
        
        const tokenMeta = metadata.find(t => t.address.toLowerCase() === targetToken.address.toLowerCase());

        const price = computeSpotPrice(pool, targetToken.address, stableAddress);
        const liquidity = computeLiquidityUSD(
          pool, 
          isToken0Stable ? 1 : price, 
          isToken0Stable ? price : 1
        );

        return {
          token: {
            ...targetToken,
            logoURI: tokenMeta?.logoURI
          },
          priceUSD: price,
          liquidityUSD: liquidity,
          volumeUSD: liquidity * 0.15,
          marketCapUSD: price * 10_000_000
        };
      });

      const snapshot: ChainSnapshot = {
        timestamp: Date.now(),
        chain: adapter.getChainName(),
        entries
      };

      this.cache.set(chainKey, snapshot);
      return snapshot;
    } finally {
      this.isUpdating.set(chainKey, false);
    }
  }

  getLatestSnapshot(chain: string): ChainSnapshot | undefined {
    return this.cache.get(chain.toLowerCase());
  }
}
