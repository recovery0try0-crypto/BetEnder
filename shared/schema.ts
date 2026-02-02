import { z } from "zod";

// === Domain Types / DTOs ===

export const tokenSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  address: z.string(),
  decimals: z.number(),
  logoURI: z.string().optional(),
});

export const tokenEntrySchema = z.object({
  token: tokenSchema,
  priceUSD: z.number(),
  liquidityUSD: z.number(),
  volumeUSD: z.number(),
  marketCapUSD: z.number(),
});

export const snapshotSchema = z.object({
  timestamp: z.number(),
  chain: z.string(), // "polygon" | "ethereum"
  entries: z.array(tokenEntrySchema),
});

// === Market Viewer Types ===
export const tokenMarketDataSchema = z.object({
  address: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.number(),
  chainId: z.number(),
  price: z.number(),
  priceChange24h: z.number().optional(),
  priceHigh24h: z.number().optional(),
  priceLow24h: z.number().optional(),
  marketCap: z.number().optional(),
  liquidity: z.number().optional(),
  volume24h: z.number().optional(),
  holders: z.number().optional(),
  logoURI: z.string().optional(),
  website: z.string().optional(),
  twitter: z.string().optional(),
  description: z.string().optional(),
  dataSource: z.enum(['explorer-api', 'rpc-call', 'cached', 'multicall', 'alchemy-api']),
  timestamp: z.number(),
  cachedUntil: z.number().optional(),
});

export const marketOverviewSchema = z.object({
  chainId: z.number(),
  tokens: z.array(tokenMarketDataSchema),
  timestamp: z.number(),
  totalLiquidity: z.number(),
  totalVolume24h: z.number(),
});

export const tokenSearchResultSchema = z.object({
  address: z.string(),
  symbol: z.string(),
  name: z.string(),
  chainId: z.number(),
  decimals: z.number(),
  logoURI: z.string().optional(),
  relevanceScore: z.number(),
});

// === Swapper Types ===
export const routeQuoteSchema = z.object({
  route: z.array(z.string()),
  amountIn: z.string(),
  amountOut: z.string(),
  priceImpact: z.number().optional(),
  executionPrice: z.number().optional(),
});

export const routeAllocationSchema = z.object({
  route: z.array(z.string()),
  amount: z.string(),
  output: z.string(),
});

export const swapQuoteSchema = z.object({
  tokenIn: z.string(),
  tokenOut: z.string(),
  amountIn: z.string(),
  route: z.array(z.string()).optional(),
  amountOut: z.string().optional(),
  distribution: z.array(routeAllocationSchema).optional(),
  finalAmountOut: z.string().optional(),
  timestamp: z.number(),
  chainId: z.number(),
});

export const quoteResponseSchema = z.object({
  success: z.boolean(),
  quote: swapQuoteSchema.optional(),
  error: z.string().optional(),
  routes: z.array(z.array(z.string())).optional(),
  timestamp: z.number(),
});

// Export types
export type Token = z.infer<typeof tokenSchema>;
export type TokenEntry = z.infer<typeof tokenEntrySchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type TokenMarketData = z.infer<typeof tokenMarketDataSchema>;
export type MarketOverview = z.infer<typeof marketOverviewSchema>;
export type TokenSearchResult = z.infer<typeof tokenSearchResultSchema>;
export type RouteQuote = z.infer<typeof routeQuoteSchema>;
export type RouteAllocation = z.infer<typeof routeAllocationSchema>;
export type SwapQuote = z.infer<typeof swapQuoteSchema>;
export type QuoteResponse = z.infer<typeof quoteResponseSchema>;

// === API Request/Response Types ===
// Used by frontend to strict type responses
export type SnapshotResponse = Snapshot;
