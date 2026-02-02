/**
 * Logo Sources Configuration
 * 
 * Centralized configuration for external APIs that provide token logo URIs
 * Used as fallback sources when explorer APIs don't return logos
 */

export interface LogoSource {
  name: string;
  baseUrl: string;
  description: string;
}

export const logoSourcesConfig = {
  /**
   * CoinGecko API - Free token data including logos
   * No authentication required
   * Coverage: 5000+ tokens across multiple chains
   * 
   * Usage: GET /api/v3/coins/{id}?localization=false
   * Returns: image.large, image.small, image.thumb
   * 
   * Important: CoinGecko uses token IDs (not addresses)
   * Requires address-to-id mapping via /coins/list endpoint
   */
  coingecko: {
    name: 'CoinGecko',
    baseUrl: 'https://api.coingecko.com/api/v3',
    description: 'Free token data with logo URIs',
    endpoints: {
      tokenList: '/coins/list?order=market_cap_desc&per_page=250&page=1&localization=false',
      tokenData: '/coins/{id}?localization=false',
    },
  } as LogoSource & { endpoints: Record<string, string> },

  /**
   * Uniswap Default Token List
   * Community-maintained token list with verified logos
   * Coverage: Popular DeFi tokens
   * 
   * Usage: GET https://tokens.uniswap.org
   * Returns: JSON with token array, each containing logoURI
   */
  uniswap: {
    name: 'Uniswap Token List',
    baseUrl: 'https://tokens.uniswap.org',
    description: 'Community token list with logos',
  } as LogoSource,

  /**
   * Trust Wallet GitHub Logo Repository
   * Direct CDN access to token logos
   * Coverage: 5000+ tokens
   * 
   * Pattern: https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/{chain}/assets/{address}/logo.png
   * Chain names: ethereum, polygon, etc.
   */
  trustwallet: {
    name: 'Trust Wallet Assets',
    baseUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains',
    description: 'Direct access to verified token logos',
  } as LogoSource,

  /**
   * 1inch Token List
   * DeFi-focused token list with logos
   * Coverage: Major DeFi tokens
   * 
   * Usage: GET https://tokens.1inch.io/v1.1/{chainId}
   */
  oneInch: {
    name: '1inch Token List',
    baseUrl: 'https://tokens.1inch.io/v1.1',
    description: 'DeFi-focused token list with logos',
  } as LogoSource,
};

/**
 * Chain name mappings for Trust Wallet (uses different names than chainId)
 */
export const trustWalletChainNames: Record<number, string> = {
  1: 'ethereum',
  137: 'polygon',
  42161: 'arbitrum',
  10: 'optimism',
  8453: 'base',
};

/**
 * Logo source fallback priority
 * Services will try sources in this order when explorer API fails
 */
export const logoSourcePriority = [
  'coingecko',   // Best coverage, free
  'uniswap',     // Community-maintained
  'trustwallet', // Direct CDN, very reliable
  'oneInch',     // DeFi-specific
];
