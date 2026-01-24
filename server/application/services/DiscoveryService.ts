import { EthersAdapter } from '../../infrastructure/adapters/EthersAdapter';
import { StorageService } from './StorageService';
import { TokenMetadata } from '../../../shared/tokens';

export class DiscoveryService {
  constructor(
    private readonly storageService: StorageService,
    private readonly ethersAdapter: EthersAdapter,
  ) {}

  async discoverPools(): Promise<void> {
    console.log('Starting pool discovery...');
    const tokens = await this.storageService.read('tokens.json') as TokenMetadata[];
    const tokensByChain = tokens.reduce((acc, token) => {
      if (!acc[token.chainId]) {
        acc[token.chainId] = [];
      }
      acc[token.chainId].push(token);
      return acc;
    }, {} as Record<number, TokenMetadata[]>);

    for (const chainId in tokensByChain) {
      const chainTokens = tokensByChain[chainId];
      const chainIdNum = parseInt(chainId, 10);
      console.log(`Discovering pools for chain ID: ${chainIdNum} with ${chainTokens.length} tokens...`);

      const poolsFileName = `pools_${chainIdNum === 1 ? 'ethereum' : 'polygon'}.json`;
      const existingPools = await this.storageService.read(poolsFileName);
      let newPoolsFound = 0;

      for (let i = 0; i < chainTokens.length; i++) {
        for (let j = i + 1; j < chainTokens.length; j++) {
          const tokenA = chainTokens[i];
          const tokenB = chainTokens[j];

          const poolKey = `${tokenA.address}_${tokenB.address}`;
          const reversePoolKey = `${tokenB.address}_${tokenA.address}`;

          if (existingPools[poolKey] || existingPools[reversePoolKey]) {
            continue;
          }

          try {
            const poolAddress = await this.ethersAdapter.getPoolAddress(tokenA, tokenB, chainIdNum);
            if (poolAddress) {
              existingPools[poolKey] = poolAddress;
              newPoolsFound++;
            }
          } catch (error) {
            console.error(`Error finding pool for ${tokenA.symbol}-${tokenB.symbol} on chain ${chainIdNum}:`, error.message);
          }
        }
      }

      if (newPoolsFound > 0) {
        console.log(`Found ${newPoolsFound} new pools for chain ID: ${chainIdNum}. Saving to ${poolsFileName}...`);
        await this.storageService.write(poolsFileName, existingPools);
      } else {
        console.log(`No new pools found for chain ID: ${chainIdNum}.`);
      }
    }

    console.log('Pool discovery finished.');
  }
}
