/**
 * LogoFetcherAdapter - Fetch token logos from multiple sources
 * 
 * Priority order:
 * 1. Etherscan/PolygonScan (handled by caller)
 * 2. CoinGecko (free, good coverage)
 * 3. Uniswap Token List
 * 4. Trust Wallet CDN
 * 5. 1inch Token List
 * 6. Empty string (fallback)
 */

import { logoSourcesConfig, trustWalletChainNames } from '../config/LogoSourcesConfig';

export class LogoFetcherAdapter {
  /**
   * Fetch logo from fallback sources
   * FIX #3: Use Promise.race with 2-second timeout for fastest response
   * Returns logo URL or empty string if not found
   */
  async fetchLogoFromFallbacks(
    tokenAddress: string,
    chainId: number
  ): Promise<string> {
    console.log(`🖼️ Fetching logo from fallback sources for ${tokenAddress.slice(0, 8)}... on chain ${chainId}`);

    try {
      // Try all sources in parallel with 2-second timeout
      const logoPromises = [
        this.fetchFromCoinGecko(tokenAddress, chainId).catch(() => ''),
        this.fetchFromUniswap(tokenAddress, chainId).catch(() => ''),
        this.fetchFromTrustWallet(tokenAddress, chainId).catch(() => ''),
        this.fetchFrom1Inch(tokenAddress, chainId).catch(() => ''),
      ];

      const sources = ['CoinGecko', 'Uniswap', 'Trust Wallet', '1inch'];
      
      // Race: return first successful result or empty after 2s
      const racePromises = logoPromises.map((p, i) => 
        p.then(result => {
          if (result) {
            console.log(`  ✓ Found logo via ${sources[i]}`);
            return result;
          }
          return Promise.reject('no logo');
        })
      );

      const timeoutPromise = new Promise<string>((resolve) => {
        setTimeout(() => resolve(''), 2000);
      });

      const logo = await Promise.race([
        Promise.any(racePromises).catch(() => ''),
        timeoutPromise,
      ]);

      if (!logo) {
        console.log(`  ⚠️ No logo found in fallback sources (timeout or all failed)`);
      }
      return logo || '';
    } catch (err) {
      console.warn(`  ⚠️ Logo fetcher error:`, (err as Error).message);
      return '';
    }
  }

  /**
   * Fetch from CoinGecko
   * Requires mapping token address to CoinGecko ID via /coins/list endpoint
   */
  private async fetchFromCoinGecko(
    tokenAddress: string,
    chainId: number
  ): Promise<string> {
    const chainMap: Record<number, string> = {
      1: 'ethereum',
      137: 'polygon',
    };

    const chainName = chainMap[chainId];
    if (!chainName) return '';

    // This would require a full token list lookup, which is complex
    // For now, return empty (future enhancement)
    // const url = `${logoSourcesConfig.coingecko.baseUrl}/coins/list?order=market_cap_desc&per_page=250&page=1&localization=false`;
    // const response = await fetch(url);
    // const tokens = await response.json() as any[];
    // const tokenEntry = tokens.find(t => t.platforms?.[chainName]?.toLowerCase() === tokenAddress.toLowerCase());
    // if (tokenEntry) {
    //   const tokenData = await fetch(`${logoSourcesConfig.coingecko.baseUrl}/coins/${tokenEntry.id}?localization=false`);
    //   const data = await tokenData.json() as any;
    //   return data.image?.large || '';
    // }
    
    return '';
  }

  /**
   * Fetch from Uniswap Token List
   * Uniswap maintains a JSON list of tokens with logos
   */
  private async fetchFromUniswap(
    tokenAddress: string,
    _chainId: number
  ): Promise<string> {
    try {
      const response = await fetch(logoSourcesConfig.uniswap.baseUrl);
      const data = await response.json() as any;

      // Search tokens by address
      const token = data.tokens?.find(
        (t: any) => t.address?.toLowerCase() === tokenAddress.toLowerCase()
      );

      if (token?.logoURI) {
        return token.logoURI;
      }
    } catch (err) {
      // Silently fail
    }

    return '';
  }

  /**
   * Fetch from Trust Wallet GitHub CDN
   * Direct URL: https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/{chain}/assets/{address}/logo.png
   */
  private async fetchFromTrustWallet(
    tokenAddress: string,
    chainId: number
  ): Promise<string> {
    const chainName = trustWalletChainNames[chainId];
    if (!chainName) return '';

    const logoUrl = `${logoSourcesConfig.trustwallet.baseUrl}/${chainName}/assets/${tokenAddress}/logo.png`;

    try {
      const response = await fetch(logoUrl, { method: 'HEAD' });
      if (response.ok) {
        return logoUrl;
      }
    } catch (err) {
      // File doesn't exist or network error
    }

    return '';
  }

  /**
   * Fetch from 1inch Token List
   * 1inch maintains token lists per chain
   */
  private async fetchFrom1Inch(
    tokenAddress: string,
    chainId: number
  ): Promise<string> {
    try {
      const url = `${logoSourcesConfig.oneInch.baseUrl}/${chainId}`;
      const response = await fetch(url);
      const data = await response.json() as any;

      // Search tokens by address
      const token = data.tokens?.find(
        (t: any) => t.address?.toLowerCase() === tokenAddress.toLowerCase()
      );

      if (token?.logoURI) {
        return token.logoURI;
      }
    } catch (err) {
      // Silently fail
    }

    return '';
  }
}

export const logoFetcherAdapter = new LogoFetcherAdapter();
