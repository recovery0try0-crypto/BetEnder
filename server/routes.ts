import type { Express } from "express";
import { api } from "../shared/routes.ts";
import { priceViewerService } from "./application/services/PriceViewerService.ts";
import { SwapController } from "./application/services/SwapController.ts";
import { sharedStateCache } from "./application/services/SharedStateCache.ts";
import { poolController } from "./application/services/PoolController.ts";
import { MarketViewerService, createMarketViewerService } from "./application/services/MarketViewerService.ts";
import { getApiCallLogger } from "./infrastructure/logging/ApiCallLogger.ts";
import { timingConfig } from "./infrastructure/config/TimingConfig.ts";
import { logoSourcesConfig } from "./infrastructure/config/LogoSourcesConfig.ts";
import { logoFetcherAdapter } from "./infrastructure/adapters/LogoFetcherAdapter.ts";
import { MockPoolDataConfig } from "./infrastructure/config/MockPoolDataConfig.ts";
import type { QuoteResponse, SwapQuote, MarketOverview } from "../shared/schema.ts";

export async function registerRoutes(
  app: Express,
  priceViewerService: any,
  swapController: any,
): Promise<Express> {
  // Initialize services
  const marketViewerService = createMarketViewerService(app.locals.storageService);
  const apiLogger = getApiCallLogger();
  const TOKENS_PER_PAGE = timingConfig.TOKENS_PER_PAGE;

  /**
   * PHASE 8: Sort tokens by specified field
   * Supported fields: symbol, name, address, decimals
   * @param tokens Array of tokens to sort
   * @param sortParam Sort field (format: "field" or "field_desc" for descending)
   * @returns Sorted token array
   */
  const sortTokens = (tokens: any[], sortParam: string): any[] => {
    const isDescending = sortParam.endsWith('_desc');
    const sortField = isDescending ? sortParam.slice(0, -5) : sortParam;
    
    const sorted = [...tokens].sort((a, b) => {
      let aVal: any, bVal: any;
      
      switch (sortField) {
        case 'symbol':
          aVal = (a.symbol || '').toLowerCase();
          bVal = (b.symbol || '').toLowerCase();
          break;
        case 'name':
          aVal = (a.name || '').toLowerCase();
          bVal = (b.name || '').toLowerCase();
          break;
        case 'address':
          aVal = (a.address || '').toLowerCase();
          bVal = (b.address || '').toLowerCase();
          break;
        case 'decimals':
          aVal = a.decimals || 0;
          bVal = b.decimals || 0;
          break;
        default:
          // Default to symbol
          aVal = (a.symbol || '').toLowerCase();
          bVal = (b.symbol || '').toLowerCase();
      }
      
      // Compare
      if (typeof aVal === 'string') {
        return isDescending ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
      } else {
        return isDescending ? bVal - aVal : aVal - bVal;
      }
    });
    
    return sorted;
  };

  app.get(api.tokens.getAll.path, async (req, res) => {
    try {
      // Get chainId from query parameter (REQUIRED - no default)
      const chainId = req.query.chainId ? Number(req.query.chainId) : null;
      if (!chainId || (chainId !== 1 && chainId !== 137)) {
        return res.status(400).json({ message: "chainId is required and must be 1 (Ethereum) or 137 (Polygon)" });
      }
      
      // Get pagination and sorting parameters
      const page = req.query.page ? Math.max(1, Number(req.query.page)) : 1;
      const sortParam = (req.query.sort as string) || 'symbol'; // Default: sort by symbol
      console.log(`📋 Fetching tokens: chain=${chainId}, page=${page}, sort=${sortParam}, pageSize=${TOKENS_PER_PAGE}`);
      
      // COLD PATH: Fetch ONLY tokens for selected network
      const tokens = await app.locals.storageService.getTokensByNetwork(chainId);
      const poolRegistry = await app.locals.storageService.getPoolRegistry(chainId);
      
      // PHASE 8: Sort tokens before pagination
      const sortedTokens = sortTokens(tokens, sortParam);
      
      // Calculate pagination
      const startIndex = (page - 1) * TOKENS_PER_PAGE;
      const paginatedTokens = sortedTokens.slice(startIndex, startIndex + TOKENS_PER_PAGE);
      
      console.log(`✓ Token pagination: ${paginatedTokens.length} tokens returned (total: ${tokens.length}, page: ${page})`);
      
      // Attach pricing pools to each token (cold path responsibility)
      const tokensWithPools = paginatedTokens.map((token: any) => {
        const pools = poolRegistry.pricingRoutes[token.address.toLowerCase()] || [];
        console.log(`   Token ${startIndex + paginatedTokens.indexOf(token) + 1}: ${token.symbol.padEnd(6)} ${token.address.slice(0,8)}... → ${pools.length} pricing route(s)`);
        return {
          ...token,
          pricingPools: pools,
        };
      });
      
      res.json({ 
        tokens: tokensWithPools, 
        chainId,
        sort: sortParam,
        pagination: {
          currentPage: page,
          pageSize: TOKENS_PER_PAGE,
          totalTokens: tokens.length,
          totalPages: Math.ceil(tokens.length / TOKENS_PER_PAGE),
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // MARKET VIEWER ENDPOINTS
  
  /**
   * GET /api/market/overview?chainId=1
   * Get market overview for all tokens on a network
   * Returns: MarketOverview with all tokens and aggregate metrics
   */
  app.get('/api/market/overview', async (req, res) => {
    try {
      const chainId = req.query.chainId ? Number(req.query.chainId) : 137;
      
      const startTime = Date.now();
      const overview = await marketViewerService.getMarketOverview(chainId);
      const durationMs = Date.now() - startTime;
      
      apiLogger.logSuccess('MarketViewer', `/api/market/overview`, chainId, durationMs, {
        requestedBy: 'Dashboard',
        purpose: 'market-overview',
      });
      
      res.json(overview);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching market overview" });
    }
  });

  /**
   * GET /api/market/token/:tokenAddress?chainId=1
   * Get detailed market data for a single token
   * Returns: TokenMarketData with price, liquidity, volume, and data source attribution
   */
  app.get('/api/market/token/:tokenAddress', async (req, res) => {
    try {
      const { tokenAddress } = req.params;
      const chainId = req.query.chainId ? Number(req.query.chainId) : 137;
      const forceRefresh = req.query.forceRefresh === 'true';
      
      const startTime = Date.now();
      const marketData = await marketViewerService.getTokenMarketData(
        tokenAddress,
        chainId,
        { forceRefresh }
      );
      const durationMs = Date.now() - startTime;
      
      apiLogger.logSuccess('MarketViewer', `/api/market/token/${tokenAddress}`, chainId, durationMs, {
        requestedBy: 'TokenDetails',
        purpose: `token-market-data`,
        cached: !forceRefresh,
      });
      
      res.json(marketData);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching token market data" });
    }
  });

  /**
   * GET /api/market/search?q=USDC&chainId=1
   * Search for tokens by symbol, name, or address
   * Returns: TokenSearchResult[] - matching tokens sorted by relevance
   */
  app.get('/api/market/search', async (req, res) => {
    try {
      const query = req.query.q as string;
      const chainId = req.query.chainId ? Number(req.query.chainId) : 137;
      
      if (!query || query.length === 0) {
        return res.status(400).json({ message: "Search query required (q parameter)" });
      }
      
      const startTime = Date.now();
      const results = await marketViewerService.searchTokens(query, chainId);
      const durationMs = Date.now() - startTime;
      
      apiLogger.logSuccess('MarketViewer', `/api/market/search?q=${query}`, chainId, durationMs, {
        requestedBy: 'TokenSelector',
        purpose: 'token-search',
      });
      
      res.json(results);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error searching tokens" });
    }
  });

  /**
   * GET /api/market/cache/status
   * Get cache statistics for debugging and monitoring
   * Returns: Cache status info
   */
  app.get('/api/market/cache/status', async (req, res) => {
    try {
      const status = marketViewerService.getCacheStatus();
      res.json(status);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error getting cache status" });
    }
  });

  /**
   * DELETE /api/market/cache
   * Clear market viewer cache (for testing/manual refresh)
   */
  app.delete('/api/market/cache', async (req, res) => {
    try {
      marketViewerService.clearCache();
      res.json({ message: "Cache cleared successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error clearing cache" });
    }
  });

  /**
   * POST /api/market/stay-alive
   * Client sends periodic keep-alive to maintain pool refresh
   * Request: { tokenAddresses: [addr1, addr2, ...], chainId: 137, ttl: 30000 }
   * Backend: Increments refCount for each token's pricing pools
   * 
   * This implements the demand-driven refresh protocol:
   * - Client sends stay-alive every 30s while user watches tokens
   * - Backend increments refCount on each request
   * - GCManager decrements and removes pools when refCount=0
   */
  app.post('/api/market/stay-alive', async (req, res) => {
    try {
      const { tokenAddresses, chainId, ttl } = req.body;

      if (!tokenAddresses || !Array.isArray(tokenAddresses)) {
        return res.status(400).json({ message: "tokenAddresses must be an array" });
      }

      if (!chainId || (chainId !== 1 && chainId !== 137)) {
        return res.status(400).json({ message: "chainId is required and must be 1 (Ethereum) or 137 (Polygon)" });
      }

      console.log(`💓 [STAY-ALIVE] Request for ${tokenAddresses.length} tokens on chain ${chainId}`);
      const startTime = Date.now();

      // Get pool registry for this chain
      const poolRegistry = await app.locals.storageService.getPoolRegistry(chainId);

      // For each token, increment refCount for all its pricing pools
      let totalPoolsIncremented = 0;
      for (const tokenAddr of tokenAddresses) {
        const tokenLower = tokenAddr.toLowerCase();
        const routes = poolRegistry.pricingRoutes[tokenLower] || [];
        
        for (const route of routes) {
          // PoolController.incrementRefCount handles the tracking
          poolController.incrementRefCount(route.pool, chainId);
          totalPoolsIncremented++;
        }
      }

      const durationMs = Date.now() - startTime;

      console.log(`✓ [STAY-ALIVE] Incremented refCount for ${totalPoolsIncremented} pools (${durationMs}ms)`);

      res.json({
        message: "Stay-alive updated",
        tokenCount: tokenAddresses.length,
        poolsIncremented: totalPoolsIncremented,
        chainId,
        ttl,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[STAY-ALIVE] Error:', error);
      res.status(500).json({ message: "Error processing stay-alive request" });
    }
  });

  // SWAPPER ENDPOINTS
  
  /**
   * POST /api/swap/quote
   * Get quote for a swap
   * Request: { tokenIn, tokenOut, amountIn, chainId }
   * Returns: QuoteResponse with route and amount details
   */
  /**
   * POST /api/tokens
   * Add a new token address for discovery and validation
   * 
   * Request body:
   * {
   *   "tokenAddress": "0x...",
   *   "chainId": 137
   * }
   * 
   * Flow:
   * 1. Fetch token metadata from contract (name, symbol, decimals)
   * 2. Add to quarantine registry with fetched metadata
   * 3. QuarantineValidator will discover pools and validate
   * 4. On validation pass: promote to primary registry
   * 
   * Response:
   * {
   *   "message": "Token added to quarantine",
   *   "tokenAddress": "0x...",
   *   "metadata": { "symbol": "...", "name": "...", "decimals": 18 },
   *   "status": "pending"
   * }
   */
  app.post('/api/tokens', async (req, res) => {
    try {
      const { tokenAddress, chainId } = req.body;

      // Validate inputs
      if (!tokenAddress || !chainId) {
        return res.status(400).json({ message: 'tokenAddress and chainId required' });
      }

      if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
        return res.status(400).json({ message: 'Invalid token address format' });
      }

      if (chainId !== 1 && chainId !== 137) {
        return res.status(400).json({ message: 'chainId must be 1 (Ethereum) or 137 (Polygon)' });
      }

      console.log(`➕ [TOKENS] Adding token ${tokenAddress.slice(0, 8)}... on chain ${chainId}`);

      const tokenKey = tokenAddress.toLowerCase();

      // FIX #1: Load registries in parallel instead of sequentially
      const [primaryTokens, quarantine] = await Promise.all([
        app.locals.storageService.getTokensByNetwork(chainId),
        app.locals.storageService.getQuarantineRegistry(chainId),
      ]);
      if (primaryTokens.some((t: any) => t.address.toLowerCase() === tokenKey)) {
        return res.status(409).json({
          message: 'Token already exists',
          status: 'exists',
          tokenAddress,
        });
      }

      // Check if already in quarantine
      if (quarantine.entries[tokenKey]) {
        const entry = quarantine.entries[tokenKey];
        if (entry.promoted) {
          return res.status(409).json({
            message: 'Token already promoted',
            status: 'promoted',
            tokenAddress,
          });
        }
        return res.status(409).json({
          message: 'Token already in quarantine',
          status: 'pending',
          tokenAddress,
          metadata: entry.metadata,
        });
      }

      // IDENTITY: Fetch token metadata from contract + explorer
      // First try explorer API (returns name, symbol, decimals, AND logo)
      // Fallback sources: LogoFetcherAdapter (CoinGecko, Uniswap, Trust Wallet, 1inch)
      // Final fallback: RPC if all APIs fail
      let metadata;
      try {
        console.log(`  🔗 Fetching metadata from explorer for ${tokenAddress.slice(0, 8)}...`);
        const explorer = app.locals.explorerConfig.getExplorer(chainId);
        let explorerLogo = '';
        
        if (explorer.apiKey) {
          try {
            const explorerUrl = `${explorer.baseUrl}?module=token&action=tokeninfo&contractaddress=${tokenAddress}&apikey=${explorer.apiKey}`;
            const explorerResponse = await fetch(explorerUrl);
            const explorerData = await explorerResponse.json() as any;
            
            if (explorerData.status === "1" && explorerData.result && explorerData.result[0]) {
              const info = explorerData.result[0];
              explorerLogo = info.logo || info.logoURI || '';
              metadata = {
                name: info.tokenName || info.name || 'Unknown Token',
                symbol: info.symbol || 'UNKNOWN',
                decimals: parseInt(info.divisor || info.decimals || '18'),
                logoURI: explorerLogo,
                logoFetchedAt: Date.now(),
              };
              console.log(`  ✓ Fetched from ${explorer.name}: ${metadata.symbol} (${metadata.name}), decimals=${metadata.decimals}, logo=${metadata.logoURI ? 'yes' : 'no'}`);
            }
          } catch (err) {
            console.log(`  ⚠️  Explorer API failed, trying fallback sources`);
          }
        }
        
        // If explorer didn't return a logo, try fallback sources
        if (!explorerLogo && metadata) {
          console.log(`  🔄 Explorer had no logo, trying fallback sources...`);
          const fallbackLogo = await logoFetcherAdapter.fetchLogoFromFallbacks(tokenAddress, chainId);
          if (fallbackLogo) {
            metadata.logoURI = fallbackLogo;
            metadata.logoFetchedAt = Date.now();
          }
        }
        
        // Fallback: fetch from contract RPC if explorer failed completely
        if (!metadata) {
          console.log(`  📝 Fetching from contract RPC for ${tokenAddress.slice(0, 8)}...`);
          const rpcMetadata = await app.locals.ethersAdapter.getTokenMetadata(tokenAddress, chainId);
          
          // Try to get logo from fallback sources even if RPC succeeds
          const fallbackLogo = await logoFetcherAdapter.fetchLogoFromFallbacks(tokenAddress, chainId);
          
          metadata = {
            ...rpcMetadata,
            logoURI: fallbackLogo,
            logoFetchedAt: fallbackLogo ? Date.now() : undefined,
          };
          console.log(`  ✓ Fetched from RPC: ${metadata.symbol} (${metadata.name}), decimals=${metadata.decimals}`);
        }
      } catch (err) {
        console.error(`  ❌ Error fetching metadata:`, err);
        metadata = {
          symbol: 'UNKNOWN',
          name: 'Unknown Token',
          decimals: 18,
          logoURI: '',
        };
      }

      // Add to quarantine registry with fetched metadata
      quarantine.entries[tokenKey] = {
        address: tokenKey,
        metadata,
        discoveredAt: Date.now(),
        validationScheduled: false,
        promoted: false,
      };

      // Save quarantine registry
      await app.locals.storageService.saveQuarantineRegistry(chainId, quarantine);

      console.log(`✅ [TOKENS] Token ${tokenAddress.slice(0, 8)}... added to quarantine for validation`);

      res.json({
        message: 'Token added to quarantine',
        tokenAddress,
        metadata,
        status: 'pending',
      });
    } catch (error) {
      console.error('[TOKENS] Error adding token:', error);
      res.status(500).json({ message: 'Error adding token' });
    }
  });

  app.post('/api/swap/quote', async (req, res) => {
    try {
      const { tokenIn, tokenOut, amountIn, chainId } = req.body;

      if (!tokenIn || !tokenOut || !amountIn) {
        return res.status(400).json({ message: "Missing required parameters: tokenIn, tokenOut, amountIn" });
      }

      const startTime = Date.now();
      const quote = await swapController.getQuote(tokenIn, tokenOut, amountIn);
      const durationMs = Date.now() - startTime;
      
      const chainIdValue = chainId || 137;
      apiLogger.logSuccess('SwapController', `/api/swap/quote`, chainIdValue, durationMs, {
        requestedBy: 'SwapInterface',
        purpose: 'quote',
      });

      const response: QuoteResponse = {
        success: quote !== null,
        quote: quote
          ? {
              tokenIn,
              tokenOut,
              amountIn,
              ...(quote.route && { route: quote.route }),
              ...(quote.amountOut && { amountOut: quote.amountOut }),
              ...(quote.distribution && { distribution: quote.distribution }),
              ...(quote.finalAmountOut && { finalAmountOut: quote.finalAmountOut }),
              timestamp: Date.now(),
              chainId: chainIdValue,
            }
          : undefined,
        timestamp: Date.now(),
      };

      res.json(response);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(error);
      res.status(500).json({
        success: false,
        error: errorMsg,
        timestamp: Date.now(),
      });
    }
  });

  app.post(`${api.snapshots.getLatest.path}/:chain`, async (req, res) => {
    try {
      const tokenAddresses = req.body.tokens;
      const chain = Number(req.params.chain);
      if (!tokenAddresses || !Array.isArray(tokenAddresses)) {
        return res.status(400).json({ message: "Missing required parameter: tokens (must be an array)" });
      }
      const prices = priceViewerService.getSnapshots(tokenAddresses, chain);
      res.json(prices);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Test endpoint to populate mock pool data for UI testing
  app.post('/api/test/populate-pools', async (req, res) => {
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      
      // Populate mock pools with timestamps
      for (const poolData of MockPoolDataConfig.pools) {
        sharedStateCache.setPoolState(poolData.address, {
          ...poolData,
          timestamp,
        });
      }

      // Set token metadata
      for (const token of Object.values(MockPoolDataConfig.tokens)) {
        sharedStateCache.setTokenMetadata(token.address, {
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
        });
      }

      res.json({
        message: 'Mock pools populated successfully',
        poolsCount: MockPoolDataConfig.pools.length,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error populating test data" });
    }
  });

  /**
   * GET /api/logs/status
   * Get API call logging statistics (for debugging/monitoring)
   */
  app.get('/api/logs/status', (req, res) => {
    try {
      const stats = apiLogger.getStats();
      res.json(stats);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error getting logs" });
    }
  });

  /**
   * GET /api/logs/recent
   * Get recent API call logs
   */
  app.get('/api/logs/recent', (req, res) => {
    try {
      const count = req.query.count ? Number(req.query.count) : 50;
      const logs = apiLogger.getRecentLogs(count);
      res.json(logs);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error getting recent logs" });
    }
  });

  return app;
}
