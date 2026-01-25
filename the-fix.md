# Architectural Refactor Plan: DEX Aggregator

This document outlines the architectural separation of the Price Viewer and Swap Quote Engine, and provides a step-by-step plan to refactor the current project without breaking functionality.

---

## 1. The Core Problem: System Conflation

The original architecture incorrectly mixed two fundamentally different systems:

-   **Market Price Viewer:** An informational tool to answer "What is the general price of Token X in USD?" It needs to be fast and lightweight.
-   **Swap Quote Engine:** A transactional tool to answer "If I trade X amount of Token A, exactly how much of Token B will I get back?" It needs to be precise and account for amount-specific details like price impact (slippage) and gas fees.

Conflating them leads to an architecture that is either dangerously inaccurate for swapping or unnecessarily complex and slow for simple price viewing.

---

## 2. The New Architecture

### 2.1. The Shared State Cache

The new cache will no longer store computed prices. It will store the foundational, raw data that both systems use to compute their own answers.

-   **Contents:**
    -   **Pool State Store:** `(Key: PoolAddress) -> { reservesA, reservesB, fee, timestamp }` (Short TTL)
    -   **Token Metadata Store:** `(Key: TokenAddress) -> { symbol, name, decimals }` (Long TTL)
-   **Price Viewer Interaction:** Performs a single, targeted read to get the reserves of one reference pool (e.g., WETH/USDC) to calculate a spot price.
-   **Swap Engine Interaction:** Performs multiple reads to gather the state of *all* pools involved in *all* potential trade routes to run a complex simulation.

### 2.2. System 1: The Price Viewer

**Purpose:** Fast, lightweight, informational USD prices.

| Module | Responsibility |
| :--- | :--- |
| **`PriceViewerService`** | Entry point for all price snapshot requests. Manages caching. |
| **`SpotPricingEngine`** | Contains the simple logic to calculate a spot price from a single pool's reserve ratio. Reads from the `SharedStateCache`. |
| **`Dashboard.tsx`** | UI for displaying informational prices. |

### 2.3. System 2: The Swap Quote Engine

**Purpose:** Precise, executable quotes for a specific trade amount.

| Module | Responsibility |
| :--- | :--- |
| **`QuoteController`** | Entry point for all `/api/quote` requests. |
| **`RoutingEngine`** | Builds a token graph from `SharedStateCache`, finds all viable paths (e.g., A->B, A->C->B) for a swap using BFS. |
| **`TradeSimulator`** | Simulates the user's `amountIn` across each path, calculating amount-dependent slippage and gas costs to find the optimal route and/or split that maximizes `amountOut`. |
| **`SwapInterface.tsx`**| UI for inputting a trade (`tokenIn`, `tokenOut`, `amountIn`). |

---

## 3. Incremental Refactor Plan

This plan gradually transforms the project, ensuring functionality is maintained at each step.

### Phase 1: Foundational Cache Implementation

*Objective: Replace the flawed, price-based cache with the new `SharedStateCache`.*

1.  **Create `SharedStateCache`:** Implement the new cache module (`server/application/services/SharedStateCache.ts`) for storing `PoolState` and `TokenMetadata`.
2.  **Integrate `DiscoveryService`:** Modify the `DiscoveryService` to populate the new `SharedStateCache` instead of its current behavior.
3.  **Preserve Old Cache:** Do not delete the old cache yet.

### Phase 2: Isolate the Price Viewer

*Objective: Formally separate the Price Viewer and make it the first consumer of the new cache.*

1.  **Create `PriceViewerService` & `SpotPricingEngine`:** Create the new backend modules.
2.  **Relocate Logic:** Move the simple `computeSpotPrice` logic into the `SpotPricingEngine`.
3.  **Connect to New Cache:** The `SpotPricingEngine` will read its data directly from the `SharedStateCache`.
4.  **Redirect API Route:** Point the existing `/api/snapshot/:chain` endpoint to the new `PriceViewerService`. The frontend dashboard will continue working, now powered by the correct architecture.

### Phase 3: Create the Swap Engine "Shim"

*Objective: Get the Swap UI working again with a temporary placeholder backend to preserve the user experience.*

1.  **Create `QuoteController` (Shim Version):** Create the new `/api/quote` endpoint.
2.  **Implement Temporary Logic:** For now, the `QuoteController` will simply call the `SpotPricingEngine` to return a spot price. This is inaccurate for quoting but keeps the UI functional.
3.  **Connect Frontend:** Modify `SwapInterface.tsx` to call the new `/api/quote` endpoint.

### Phase 4: Build the Real Swap Engine in Isolation

*Objective: Develop the complex backend logic without touching the working application.*

1.  **Develop `RoutingEngine`:** Implement the graph construction and pathfinding algorithms.
2.  **Develop `TradeSimulator`:** Implement the algorithms for slippage simulation, gas cost accounting, and optimal split-routing. Add extensive unit tests.

### Phase 5: The "Hot Swap"

*Objective: Replace the placeholder shim with the real, powerful engine.*

1.  **Modify `QuoteController`:** Open the `QuoteController` module.
2.  **Remove Shim Logic:** Delete the temporary call to the `SpotPricingEngine`.
3.  **Implement Real Logic:** Wire the `QuoteController` to the `RoutingEngine` and `TradeSimulator` to produce precise, amount-dependent `TradeExecutionPlans`.
4.  **Cleanup:** All old, unreferenced pricing and caching code can now be safely deleted.

---
## 4. Detailed Implementation Steps

### Phase 1 Details:
- **`SharedStateCache.ts`**: Will be a class with a Map-based implementation. It should expose methods like `getPoolState(address: string): PoolState | undefined`, `setPoolState(address: string, state: PoolState)`, `getTokenMetadata(address: string): TokenMetadata | undefined`, and `setTokenMetadata(address: string, meta: TokenMetadata)`.
- **`DiscoveryService.ts`**: On server startup, this service will be responsible for reading the `pools_*.json` and any token metadata files. It will then iterate through this data and call `SharedStateCache.setPoolState` and `SharedStateCache.setTokenMetadata` to prime the cache. A new method, `refreshPools()`, will be added to allow for periodic updates fetched from the blockchain via the `EthersAdapter`.

### Phase 2 Details:
- **`SpotPricingEngine.ts`**: This module will contain the `computeSpotPrice(tokenAddress: string)` function. Its logic will be:
    1.  Access the `SharedStateCache` to find all pools containing `tokenAddress`.
    2.  Filter these pools to find the one paired with a primary stablecoin (e.g., USDC, WETH) that has the highest liquidity (total value of reserves).
    3.  Call `SharedStateCache.getPoolState()` for that single best pool's address.
    4.  Calculate the price from the reserves, adjusting for token decimals fetched from `SharedStateCache.getTokenMetadata()`.
- **`PriceViewerService.ts`**: This will expose a method `getSnapshots(tokenAddresses: string[])`. It will loop through the addresses and call `computeSpotPrice` for each. It will be responsible for handling errors if a price cannot be found.
- **API Route Modification**: The Express route handler for `/api/snapshot/:chain` will be changed to `async (req, res) => { const prices = await priceViewerService.getSnapshots(req.body.tokens); res.json(prices); }`.

### Phase 3 Details:
- **`QuoteController.ts` (Shim)**: The new `/api/quote` endpoint will accept a POST request with the body `{ tokenIn: string, tokenOut: string, amountIn: string }`.
- **Shim Logic**: The controller will *ignore* `amountIn`. It will call `spotPricingEngine.computeSpotPrice(tokenIn)` and `spotPricingEngine.computeSpotPrice(tokenOut)` to get their USD values. It will return a simple object like `{ estimatedRate: priceInUSD / priceOutUSD }`. This is a "lie", but it keeps the UI from crashing.
- **`SwapInterface.tsx`**: The `useEffect` or `useQuery` hook that fetches the quote will be updated to `POST` to `/api/quote` and will be programmed to display the `estimatedRate`.

### Phase 4 Details:
- **`RoutingEngine.ts` Development**:
    - **Graph Building**: The constructor will accept the `SharedStateCache` as a dependency. It will build an adjacency list (`Map<string, Set<string>>`) representing all possible connections from the pool data.
    - **Pathfinding**: The `findRoutes(tokenIn: string, tokenOut: string, maxDepth: number = 3)` method will perform a Breadth-First Search (BFS) on the graph. It will return an array of paths, where each path is an array of token addresses, e.g., `[['0xTokenA', '0xTokenD'], ['0xTokenA', '0xTokenB', '0xTokenD']]`.
- **`TradeSimulator.ts` Development**:
    - **`simulatePath(path: string[], amountIn: BigNumber)`**: This internal function will iterate through a single path. For each leg (e.g., A->B), it fetches the corresponding pool from the cache and calculates the output amount using the constant product formula, subtracting the pool's fee. The output of one leg is the input for the next.
    - **`findOptimalSplit(...)`**: This is the main public method.
        1.  It receives the `CandidatePaths` from the `RoutingEngine` and the user's `amountIn`.
        2.  For each path, it will calculate a `netAmountOut` by calling `simulatePath` and then subtracting the estimated gas cost of the path (converted into `tokenOut`).
        3.  It will then use an iterative allocation algorithm. It starts by distributing small portions of the `amountIn` to the path that offers the best marginal price. As volume is added to a path, its marginal price worsens.
        4.  The loop continues, always adding the next increment of volume to the path that is currently most efficient at the margin, until the full `amountIn` is allocated.
        5.  The final output is a `TradeExecutionPlan` object: `{ finalAmountOut: BigNumber, distribution: [{ route: string[], amount: BigNumber }] }`.

### Phase 5 Details:
- **The "Hot Swap" in `QuoteController.ts`**:
    - The code inside the `/api/quote` endpoint handler will be entirely replaced.
    - **Old Shim Code (to be deleted):**
        ```typescript
        // const rate = await getSimpleRate(tokenIn, tokenOut);
        // res.json({ estimatedRate: rate });
        ```
    - **New Engine Code (to be implemented):**
        ```typescript
        // const routes = await routingEngine.findRoutes(tokenIn, tokenOut);
        // const tradePlan = await tradeSimulator.findOptimalSplit(routes, amountIn);
        // res.json(tradePlan);
        ```
- **Final Cleanup**: After confirming the new engine works, the following can be deleted:
    - The old cache service module.
    - The `server/domain/pricing.ts` file, as its logic now resides in `SpotPricingEngine.ts`.
    - Any other helper functions related to the old, inaccurate pricing model.