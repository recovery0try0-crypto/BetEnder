/**
 * ProvidersConfig - Centralized API Provider Configuration
 * 
 * SINGLE SOURCE OF TRUTH for all external API calls:
 * - RPC Providers (Infura, Alchemy)
 * - Block Explorer APIs (Etherscan, PolygonScan)
 * - Data Sources for Market Viewer and Swapper
 * 
 * API CALL SOURCES:
 * - Infura: RPC calls HOT PATH ONLY
 * - Alchemy: RPC calls HOT PATH ONLY
 * - Etherscan: COLD PATH API
 * - PolygonScan: COLD PATH API
 * 
 * - Public RPCs: Fallback endpoints
 * 
 * SWITCHING ENDPOINTS:
 * Change values here to switch providers globally.
 * No other files need modification.
 */

interface ProviderEndpoints { //fix tbis//
  rpc: string;
  etherscan: string;
  alchemy?: string;
  fallbackRpc?: string;
}

interface ChainProviders {
  [chainId: number]: ProviderEndpoints;
}

import { getRpcConfig } from './RpcConfig';
import { explorerConfig } from './ExplorerConfig';

class ProvidersConfig {
  private static instance: ProvidersConfig;
  
  // Lazy-loaded RPC config
  private rpcConfigInstance: any = null;

  private getRpcConfig() {
    if (!this.rpcConfigInstance) {
      this.rpcConfigInstance = getRpcConfig();
    }
    return this.rpcConfigInstance;
  }

  // Environment variables (with fallbacks)
  private infuraApiKey?: string;
  private alchemyApiKey?: string;
  private etherscanApiKey?: string;
  private polygonscanApiKey?: string;
  private polygonRpcUrl?: string;

  // Track if we've initialized
  private initialized: boolean = false;

  // ProvidersConfig is a thin facade that delegates to `rpcConfig` and `explorerConfig`.
  // It preserves the public API for backwards compatibility.

  private constructor() {
    // Don't initialize in constructor - do it lazily
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): ProvidersConfig {
    if (!ProvidersConfig.instance) {
      ProvidersConfig.instance = new ProvidersConfig();
    }
    // Initialize on first call to getInstance
    if (!ProvidersConfig.instance.initialized) {
      ProvidersConfig.instance.doInitialize();
      ProvidersConfig.instance.initialized = true;
    }
    return ProvidersConfig.instance;
  }

  private doInitialize(): void {
    // Load from environment variables (for status reporting)
    this.infuraApiKey = process.env.INFURA_API_KEY;
    this.alchemyApiKey = process.env.ALCHEMY_API_KEY;
    this.etherscanApiKey = process.env.ETHERSCAN_API_KEY;
    this.polygonscanApiKey = process.env.POLYGONSCAN_API_KEY || process.env.POLYGON_API_KEY;
    this.polygonRpcUrl = process.env.POLYGON_RPC_URL;

    // NOTE: ProvidersConfig delegates runtime resolution to RpcConfig and ExplorerConfig.
    this.logInitialization();
  }

  /**
   * Reinitialize configuration (useful after env vars are loaded)
   */
  public reinitialize(): void {
    this.initialized = false;
    this.doInitialize();
    this.initialized = true;
  }

  /**
   * Get RPC endpoint for a specific chain
   * @param chainId Network chain ID (1 = Ethereum, 137 = Polygon)
   * @returns Primary RPC endpoint
   */
  public getRpcProvider(chainId: number): string {
    // Prefer named provider (Infura) for backward compatibility
    try {
      return this.getRpcConfig().getRpcEndpointFromProvider('Infura', chainId);
    } catch (e) {
      // Fallback to first available endpoint
      const endpoints = this.getRpcConfig().getEndpointsForChain(chainId);
      if (endpoints && endpoints.length > 0) {
        return endpoints[0].endpoint;
      }

      // Chain-specific fallback (only if explicitly configured)
      if (chainId === 137 && this.polygonRpcUrl) {
        return this.polygonRpcUrl!;
      }

      throw new Error(`No RPC provider configured for chain ${chainId}. Please set INFURA_API_KEY or ALCHEMY_API_KEY or POLYGON_RPC_URL.`);
    }
  }

  /**
   * Get fallback RPC endpoint for a specific chain
   * @param chainId Network chain ID
   * @returns Fallback RPC endpoint
   */
  public getFallbackRpcProvider(chainId: number): string {
    const endpoints = this.getRpcConfig().getEndpointsForChain(chainId);
    if (endpoints && endpoints.length > 1) {
      return endpoints[1].endpoint;
    }
    if (endpoints && endpoints.length === 1) {
      return endpoints[0].endpoint;
    }

    // Chain-specific fallback (if explicitly configured)
    if (chainId === 137 && this.polygonRpcUrl) {
      return this.polygonRpcUrl!;
    }
    if (chainId === 1 && this.alchemyApiKey) {
      return `https://eth-mainnet.g.alchemy.com/v2/${this.alchemyApiKey}`;
    }

    throw new Error(`No fallback RPC provider configured for chain ${chainId}. Please configure additional providers or set POLYGON_RPC_URL.`);
  }

  /**
   * Get Alchemy endpoint for a specific chain
   * @param chainId Network chain ID
   * @returns Alchemy RPC endpoint
   */
  public getAlchemyProvider(chainId: number): string | undefined {
    try {
      return this.getRpcConfig().getRpcEndpointFromProvider('Alchemy', chainId);
    } catch (e: any) {
      const endpoints = this.getRpcConfig().getEndpointsForChain(chainId);
      const match = endpoints.find((e: any) => e.provider === 'Alchemy');
      return match ? match.endpoint : undefined;
    }
  }

  /**
   * Get Etherscan API endpoint for a specific chain
   * @param chainId Network chain ID
   * @returns Etherscan API endpoint
   */
  public getEtherscanApi(chainId: number): string {
    try {
      return explorerConfig.getExplorerApiUrl(chainId);
    } catch (e) {
      // Fallback to legacy constructed endpoints only if API key is present
      if (chainId === 1 && this.etherscanApiKey) {
        return `https://api.etherscan.io/api?apikey=${this.etherscanApiKey}`;
      } else if (chainId === 137 && this.polygonscanApiKey) {
        return `https://api.polygonscan.com/api?apikey=${this.polygonscanApiKey}`;
      }
      throw new Error(`No block explorer API configured for chain ${chainId}. Please set ETHERSCAN_API_KEY or POLYGONSCAN_API_KEY.`);
    }
  }

  /**
   * Get all endpoints for a chain
   * @param chainId Network chain ID
   * @returns All configured endpoints for the chain
   */
  public getChainProviders(chainId: number): ProviderEndpoints {
    return {
      rpc: this.getRpcProvider(chainId),
      alchemy: this.getAlchemyProvider(chainId),
      etherscan: this.getEtherscanApi(chainId),
      fallbackRpc: this.getFallbackRpcProvider(chainId),
    };
  }

  /**
   * Get supported chain IDs
   * @returns Array of supported chain IDs
   */
  public getSupportedChains(): number[] {
    const rpcChains = Object.keys(this.getRpcConfig().getStatus().counters).map(Number);
    const explorerChains = explorerConfig.getSupportedChains();
    const union = new Set<number>([...rpcChains, ...explorerChains]);
    return Array.from(union).sort((a, b) => a - b);
  }

  /**
   * Check if a chain is supported
   * @param chainId Network chain ID
   * @returns True if chain is supported
   */
  public isChainSupported(chainId: number): boolean {
    return this.getSupportedChains().includes(chainId);
  }

  /**
   * Validate configuration
   * Logs warnings if API keys are missing or default
   */
  private logInitialization(): void {
    const warnings: string[] = [];

    if (!this.infuraApiKey) {
      warnings.push('INFURA_API_KEY not set');
    }

    if (!this.alchemyApiKey) {
      warnings.push('ALCHEMY_API_KEY not set');
    }

    if (!this.etherscanApiKey) {
      warnings.push('ETHERSCAN_API_KEY not set');
    }

    if (!this.polygonscanApiKey) {
      warnings.push('POLYGONSCAN_API_KEY not set');
    }

    if (!this.polygonRpcUrl) {
      warnings.push('POLYGON_RPC_URL not set');
    }

    const rpcStatus = this.getRpcConfig().getStatus();
    const explorers = explorerConfig.getStatus();

    console.log(`✓ ProvidersConfig: rpc providers: ${rpcStatus.providers.join(', ')}`);
    console.log(`✓ ProvidersConfig: explorers: ${explorers.explorers.map(e => e.name).join(', ')}`);

    if (warnings.length > 0) {
      console.warn('⚠️  ProvidersConfig Warnings:');
      warnings.forEach(w => console.warn(`   - ${w}`));
    }
  }

  /**
   * Get configuration status (for debugging)
   */
  public getStatus(): {
    chains: number[];
    infuraConfigured: boolean;
    alchemyConfigured: boolean;
    etherscanConfigured: boolean;
    rpcProviders: string[];
    explorers: { chainId: number; name: string }[];
  } {
    const rpcStatus = this.getRpcConfig().getStatus();
    const explorers = explorerConfig.getStatus();

    return {
      chains: this.getSupportedChains(),
      infuraConfigured: !!this.infuraApiKey,
      alchemyConfigured: !!this.alchemyApiKey,
      etherscanConfigured: !!this.etherscanApiKey,
      rpcProviders: rpcStatus.providers,
      explorers: explorers.explorers,
    };
  }
}

// Export singleton instance
export const providersConfig = ProvidersConfig.getInstance();

// Also export the class for testing
export { ProvidersConfig };
