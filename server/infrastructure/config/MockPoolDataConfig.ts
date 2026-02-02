/**
 * MockPoolDataConfig
 * 
 * Test data for the POST /api/test/populate-pools endpoint.
 * Used for UI testing and development purposes only.
 */

export interface MockTokenData {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

export interface MockPoolData {
  address: string;
  token0: string;
  token1: string;
  liquidity: bigint;
  sqrtPriceX96: bigint;
  fee: number;
  timestamp: number;
}

export const MockPoolDataConfig = {
  /**
   * Polygon test tokens
   */
  tokens: {
    USDC: {
      address: '0x2791Bca1f2de4661ED88A30C99a7a9449Aa84174',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    } as MockTokenData,
    WETH: {
      address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
    } as MockTokenData,
    WMATIC: {
      address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      symbol: 'WMATIC',
      name: 'Wrapped Matic',
      decimals: 18,
    } as MockTokenData,
    USDT: {
      address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
    } as MockTokenData,
  },

  /**
   * Test pools (Polygon network)
   */
  pools: [
    {
      // USDC-WETH pool
      address: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
      token0: '0x2791Bca1f2de4661ED88A30C99a7a9449Aa84174', // USDC
      token1: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', // WETH
      liquidity: BigInt('1000000000000000000000'),
      sqrtPriceX96: BigInt('1766847064778384329583297500742918515827483896875618543824'),
      fee: 3000,
    } as Omit<MockPoolData, 'timestamp'>,
    {
      // WMATIC-USDC pool
      address: '0xA374094527e1673A86dE625aa59517c5dE346d32',
      token0: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
      token1: '0x2791Bca1f2de4661ED88A30C99a7a9449Aa84174', // USDC
      liquidity: BigInt('500000000000000000000'),
      sqrtPriceX96: BigInt('1000000000000000000000'),
      fee: 3000,
    } as Omit<MockPoolData, 'timestamp'>,
    {
      // WETH-USDT pool
      address: '0x781067Ef296E5C4A4203F81C593274824b7C185d',
      token0: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', // WETH
      token1: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT
      liquidity: BigInt('800000000000000000000'),
      sqrtPriceX96: BigInt('1500000000000000000000'),
      fee: 3000,
    } as Omit<MockPoolData, 'timestamp'>,
  ],
};
