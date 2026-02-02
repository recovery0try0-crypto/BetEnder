import { Pool, Token } from "../../domain/entities";
import { ethers, BaseContract } from "ethers";
import { PoolState, TokenMetadata } from "../../domain/types";
import type { MulticallResult } from "../../application/services/MulticallEngine";
import { explorerConfig } from "../config/ExplorerConfig";
import { getContractAddress } from "../config/ContractAddressConfig";

const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)"
];

const MULTICALL_ABI = [
  "function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)"
];

const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 feeTier) view returns (address pool)"
];

const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function fee() view returns (uint24)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];

export class EthersAdapter {
  private providers: { [chainId: number]: ethers.JsonRpcProvider };
  private factories: { [chainId: number]: ethers.Contract };

  constructor(rpcUrls: { [chainId: number]: string }) {
    this.providers = {};
    this.factories = {};
    for (const chainId in rpcUrls) {
      this.providers[chainId] = new ethers.JsonRpcProvider(rpcUrls[chainId]);
      // Create factory for each chain using configured address
      const factoryAddress = getContractAddress(parseInt(chainId, 10), 'uniswapV3Factory');
      this.factories[chainId] = new ethers.Contract(factoryAddress, FACTORY_ABI, this.providers[chainId]);
    }
  }

  private getProvider(chainId: number): ethers.JsonRpcProvider {
    const provider = this.providers[chainId];
    if (!provider) {
      throw new Error(`Provider for chain ID ${chainId} not configured.`);
    }
    return provider;
  }

  async getTokenMetadata(tokenAddress: string, chainId: number): Promise<TokenMetadata> {
    const provider = this.getProvider(chainId);
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const [name, symbol, decimals] = await Promise.all([
        tokenContract.name(),
        tokenContract.symbol(),
        tokenContract.decimals(),
    ]);
    return { name, symbol, decimals };
  }

  async getPoolState(poolAddress: string, chainId: number): Promise<PoolState> {
    const provider = this.getProvider(chainId);
    const poolContract = new ethers.Contract(poolAddress, POOL_ABI, provider);
    const slot0 = await poolContract.slot0();
    const liquidity = await poolContract.liquidity();
    const token0 = await poolContract.token0();
    const token1 = await poolContract.token1();
    const fee = await poolContract.fee();
    return {
        address: poolAddress,
        liquidity: BigInt(liquidity.toString()),
        sqrtPriceX96: BigInt(slot0.sqrtPriceX96.toString()),
        token0,
        token1,
        fee,
        timestamp: Math.floor(Date.now() / 1000),
    };
  }

  async getPoolAddress(tokenA: Token, tokenB: Token, chainId: number, fee: number): Promise<string | null> {
    try {
      const explorer = explorerConfig.getExplorer(chainId);
      if (explorer.apiKey) {
        const baseUrl = explorer.baseUrl;
        const factoryAddress = getContractAddress(chainId, 'uniswapV3Factory');
        const url = `${baseUrl}?module=contract&action=read&address=${factoryAddress}&functionname=getPool&inputs=${tokenA.address},${tokenB.address},${fee}&apikey=${explorer.apiKey}`;
        
        const response = await fetch(url);
        const data = await response.json() as any;
        
        if (data.status === "1" && data.result && data.result !== "0x0000000000000000000000000000000000000000") {
          console.log(`✓ Found pool ${data.result.slice(0, 6)}... for ${tokenA.symbol}-${tokenB.symbol} (fee: ${fee}) via Explorer API`);
          return data.result;
        }
      }
    } catch (error) {
      console.warn(`Explorer API pool search failed, falling back to RPC:`, error);
    }

    const provider = this.getProvider(chainId);
    const factory = this.factories[chainId].connect(provider);
    try {
      const poolAddress = await (factory as BaseContract & { getPool: (a: string, b: string, c: number) => Promise<string> }).getPool(tokenA.address, tokenB.address, fee);
      if (poolAddress && poolAddress !== "0x0000000000000000000000000000000000000000") {
        console.log(`✓ Found pool ${poolAddress.slice(0, 6)}... for ${tokenA.symbol}-${tokenB.symbol} (fee: ${fee})`);
        return poolAddress;
      }
    } catch (error) {
      console.error(`✗ Error getting pool for ${tokenA.symbol}-${tokenB.symbol}:`, error);
    }
    return null;
  }

  async getPools(tokenA: Token, tokenB: Token): Promise<PoolState[]> {
    const chainId = tokenA.chainId;
    const feeTiers = [100, 500, 3000, 10000];
    const pools: PoolState[] = [];

    for (const fee of feeTiers) {
      const poolAddress = await this.getPoolAddress(tokenA, tokenB, chainId, fee);

      if (poolAddress) {
        const poolState = await this.getPoolState(poolAddress, chainId);
        pools.push(poolState);
      }
    }

    return pools;
  }

  /**
   * PHASE 4: Execute multicall batch
   * 
   * Batches pool queries together using Multicall3 contract.
   * Constructs calls for slot0() + liquidity() on each pool.
   * Returns block number and decoded results.
   * 
   * @param poolAddresses Pool addresses to query
   * @param providerIndex Which provider to use
   * @param chainId Network chain ID
   * @returns Array of results (one per pool)
   */
  public async executeMulticall(
    poolAddresses: string[],
    providerIndex: number,
    chainId: number
  ): Promise<MulticallResult[]> {
    const provider = this.getProvider(chainId);
    const multicallAddress = getContractAddress(chainId, 'multicall');
    const multicallContract = new ethers.Contract(multicallAddress, MULTICALL_ABI, provider);

    // Construct calls for each pool (slot0 + liquidity + token0 + token1)
    const calls = [];
    for (const poolAddress of poolAddresses) {
      const poolIface = new ethers.Interface(POOL_ABI);

      // slot0 call
      calls.push({
        target: poolAddress,
        callData: poolIface.encodeFunctionData('slot0', []),
      });

      // liquidity call
      calls.push({
        target: poolAddress,
        callData: poolIface.encodeFunctionData('liquidity', []),
      });

      // token0 call
      calls.push({
        target: poolAddress,
        callData: poolIface.encodeFunctionData('token0', []),
      });

      // token1 call
      calls.push({
        target: poolAddress,
        callData: poolIface.encodeFunctionData('token1', []),
      });
    }

    try {
      // Execute aggregate call
      const result = await (multicallContract as any).aggregate(calls);
      const blockNumber = Number(result.blockNumber);
      const returnData = result.returnData as string[];

      // Parse results
      const results: MulticallResult[] = [];
      const poolIface = new ethers.Interface(POOL_ABI);

      for (let i = 0; i < poolAddresses.length; i++) {
        const poolAddress = poolAddresses[i];
        const slot0Index = i * 4;
        const liquidityIndex = i * 4 + 1;
        const token0Index = i * 4 + 2;
        const token1Index = i * 4 + 3;

        try {
          const slot0Data = returnData[slot0Index];
          const liquidityData = returnData[liquidityIndex];
          const token0Data = returnData[token0Index];
          const token1Data = returnData[token1Index];

          const slot0Decoded = poolIface.decodeFunctionResult('slot0', slot0Data) as any;
          const liquidityDecoded = poolIface.decodeFunctionResult('liquidity', liquidityData) as any;
          const token0Decoded = poolIface.decodeFunctionResult('token0', token0Data) as any;
          const token1Decoded = poolIface.decodeFunctionResult('token1', token1Data) as any;

          results.push({
            poolAddress,
            blockNumber,
            success: true,
            data: {
              sqrtPriceX96: BigInt(slot0Decoded.sqrtPriceX96.toString()),
              tick: slot0Decoded.tick,
              liquidity: BigInt(liquidityDecoded.toString()),
              token0: token0Decoded,
              token1: token1Decoded,
            },
          });
        } catch (error) {
          results.push({
            poolAddress,
            blockNumber,
            success: false,
            error: error as Error,
          });
        }
      }

      return results;
    } catch (error) {
      console.error(`❌ Multicall execution failed:`, error);
      throw error;
    }
  }
}

